/**
 * Vibe Service - Provides random "wake up" messages for cold start scenarios
 */

const WAKE_UP_MESSAGES: string[] = [
  "❤️ Loading Love & Logic... Fun fact: This is the first app Husband wrote in 5 years. It runs on love (and a free server).",
  "🥶 Brrr... it's cold. I'm on a free server, so I go into a coma when you don't talk to me. Give me a sec to warm up the engines!",
  "🤖 Beep Boop... Dreamt I was a paid server with 100% uptime. Woke up and I'm still free. Loading your data...",
];

/**
 * Get a random wake-up message from the predefined array
 * @returns A random wake-up message string
 */
export function getRandomWakeUpMessage(): string {
  const randomIndex = Math.floor(Math.random() * WAKE_UP_MESSAGES.length);
  return WAKE_UP_MESSAGES[randomIndex];
}


