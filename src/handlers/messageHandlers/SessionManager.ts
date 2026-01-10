/**
 * Centralized session state management
 * 
 * Session state is stored in ctx.session (Telegraf in-memory middleware)
 * This utility provides type-safe operations on session state
 */
export class SessionManager {
  /**
   * Clear all session flags (reset to initial state)
   * @param session - The session object from ctx.session
   */
  clearSession(session: any): void {
    session.manualAddMode = false;
    session.manualAddStep = undefined;
    session.recurringMode = false;
    session.recurringStep = undefined;
    session.editLastMode = false;
    session.editLastAction = undefined;
    session.awaitingAmountConfirmation = false;
    session.awaitingPayer = false;
    session.editingTxId = undefined;
    session.waitingForSplitInput = false;
    session.splitSettingsCategory = undefined;
    // Note: Do not clear pendingReceipts - it's managed by PhotoHandler
  }

  /**
   * Initialize session if it doesn't exist
   * @param session - The session object from ctx.session (may be undefined)
   * @returns Initialized session object
   */
  ensureSession(session: any): any {
    if (!session) {
      return {};
    }
    return session;
  }

  /**
   * Check if session is in manual add mode
   */
  isManualAddMode(session: any): boolean {
    return session?.manualAddMode === true;
  }

  /**
   * Check if session is in edit mode
   */
  isEditMode(session: any): boolean {
    return !!session?.editingTxId;
  }

  /**
   * Check if session is in recurring mode
   */
  isRecurringMode(session: any): boolean {
    return session?.recurringMode === true;
  }
}
