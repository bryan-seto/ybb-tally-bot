import { ICallbackHandler } from './ICallbackHandler';

/**
 * Handler for dashboard navigation callbacks
 */
export class DashboardCallbackHandler implements ICallbackHandler {
  constructor(
    private showDashboard?: (ctx: any, editMode: boolean) => Promise<void>
  ) {}

  canHandle(data: string): boolean {
    return data === 'back_to_dashboard';
  }

  async handle(ctx: any, data: string): Promise<void> {
    // Answer the callback query to acknowledge receipt
    await ctx.answerCbQuery();

    // Show dashboard in edit mode
    if (this.showDashboard) {
      await this.showDashboard(ctx, true);
    }
  }
}


