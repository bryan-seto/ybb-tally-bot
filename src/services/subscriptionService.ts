import Stripe from 'stripe';
import { prisma } from '../lib/prisma';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

// Hardcoded VIP Telegram IDs
const VIP_TELEGRAM_IDS = [109284773, 424894363];

// Product IDs from Stripe
const MONTHLY_PRODUCT_ID = 'prod_TgMwheF4szla3f';
const YEARLY_PRODUCT_ID = 'prod_TgMwYI9LQnZFWe';

export class SubscriptionService {
  private stripe: Stripe;

  constructor() {
    if (!STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is required');
    }
    this.stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: '2025-12-15.clover',
    });
  }

  /**
   * Check if a user is a VIP (bypasses all payment checks)
   */
  isVIP(telegramId: number): boolean {
    return VIP_TELEGRAM_IDS.includes(telegramId);
  }

  /**
   * Check if a group has active subscription
   */
  async isGroupActive(groupId: bigint): Promise<boolean> {
    const group = await prisma.group.findUnique({
      where: { id: groupId },
    });

    if (!group) return false;

    // Check if trial is still valid
    if (group.subscriptionStatus === 'trial' && group.trialStartDate) {
      const trialEnd = new Date(group.trialStartDate);
      trialEnd.setDate(trialEnd.getDate() + 14);
      if (new Date() < trialEnd) {
        return true;
      }
      // Trial expired, update status
      await prisma.group.update({
        where: { id: groupId },
        data: { subscriptionStatus: 'expired' },
      });
      return false;
    }

    // Check if subscription is active and not expired
    if (group.subscriptionStatus === 'active' && group.expiryDate) {
      return new Date() < group.expiryDate;
    }

    return group.subscriptionStatus === 'active';
  }

  /**
   * Check trial eligibility for a user
   */
  async checkTrialEligibility(telegramId: number): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { telegramId: BigInt(telegramId) },
    });

    if (!user) return true; // New user, eligible for trial
    return !user.hasUsedTrial;
  }

  /**
   * Initialize group with trial or lock status
   */
  async initializeGroup(
    chatId: number,
    installerTelegramId: number
  ): Promise<{ groupId: bigint; status: 'trial' | 'locked' }> {
    // Check if group already exists
    let group = await prisma.group.findUnique({
      where: { chatId: BigInt(chatId) },
    });

    if (group) {
      return {
        groupId: group.id,
        status: group.subscriptionStatus as 'trial' | 'locked',
      };
    }

    // Get or create installer user
    let installer = await prisma.user.findUnique({
      where: { telegramId: BigInt(installerTelegramId) },
    });

    if (!installer) {
      installer = await prisma.user.create({
        data: {
          telegramId: BigInt(installerTelegramId),
          name: `User ${installerTelegramId}`,
        },
      });
    }

    // Check trial eligibility
    const isEligible = await this.checkTrialEligibility(installerTelegramId);
    const isVIP = this.isVIP(installerTelegramId);

    let subscriptionStatus: 'trial' | 'locked' = 'locked';
    let trialStartDate: Date | null = null;

    if (isEligible || isVIP) {
      subscriptionStatus = 'trial';
      trialStartDate = new Date();
      // Mark user as having used trial (unless VIP)
      if (!isVIP) {
        await prisma.user.update({
          where: { id: installer.id },
          data: { hasUsedTrial: true },
        });
      }
    }

    // Create group
    group = await prisma.group.create({
      data: {
        chatId: BigInt(chatId),
        subscriptionStatus: subscriptionStatus,
        trialStartDate: trialStartDate,
        installerUserId: installer.id,
        members: {
          connect: { id: installer.id },
        },
      },
    });

    return {
      groupId: group.id,
      status: subscriptionStatus,
    };
  }

  /**
   * Create Stripe checkout session
   */
  async createCheckoutSession(
    groupId: bigint,
    isYearly: boolean = true
  ): Promise<string> {
    const group = await prisma.group.findUnique({
      where: { id: groupId },
    });

    if (!group) {
      throw new Error('Group not found');
    }

    // Get product
    const productId = isYearly ? YEARLY_PRODUCT_ID : MONTHLY_PRODUCT_ID;
    const product = await this.stripe.products.retrieve(productId);

    // Get default price
    const prices = await this.stripe.prices.list({
      product: productId,
      active: true,
    });

    const defaultPrice = prices.data.find(
      (p) => p.id === product.default_price
    ) || prices.data[0];

    if (!defaultPrice) {
      throw new Error('No price found for product');
    }

    // Create checkout session
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [
        {
          price: defaultPrice.id,
          quantity: 1,
        },
      ],
      success_url: `${process.env.WEBHOOK_URL || 'https://your-domain.com'}/subscription-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.WEBHOOK_URL || 'https://your-domain.com'}/subscription-cancel`,
      metadata: {
        groupId: groupId.toString(),
        chatId: group.chatId.toString(),
      },
    });

    return session.url || '';
  }

  /**
   * Handle Stripe webhook event
   */
  async handleWebhookEvent(event: Stripe.Event): Promise<void> {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const groupId = BigInt(session.metadata?.groupId || '0');

      if (groupId === BigInt(0)) {
        console.error('No groupId in checkout session metadata');
        return;
      }

      // Get subscription details
      const subscriptionId = session.subscription as string;
      const subscription = await this.stripe.subscriptions.retrieve(
        subscriptionId
      );

      // Calculate expiry date
      const expiryDate = new Date((subscription as any).current_period_end * 1000);

      // Update group
      await prisma.group.update({
        where: { id: groupId },
        data: {
          subscriptionStatus: 'active',
          expiryDate: expiryDate,
        },
      });

      console.log(`Group ${groupId} subscription activated until ${expiryDate}`);
    }
  }

  /**
   * Verify Stripe webhook signature
   */
  verifyWebhookSignature(
    payload: string | Buffer,
    signature: string
  ): Stripe.Event {
    if (!STRIPE_WEBHOOK_SECRET) {
      throw new Error('STRIPE_WEBHOOK_SECRET is required');
    }

    return this.stripe.webhooks.constructEvent(
      payload,
      signature,
      STRIPE_WEBHOOK_SECRET
    );
  }
}

