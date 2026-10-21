import { t, type MessageKey } from "@/i18n";

const LANDING_GREETING_KEYS: readonly MessageKey[] = Object.freeze([
  "home.greeting.help",
  "home.greeting.start",
  "home.greeting.mind",
  "home.greeting.working",
  "home.greeting.today",
  "home.greeting.ready",
  "home.greeting.explore",
  "home.greeting.resume",
  "home.greeting.serve",
  "home.greeting.capture",
  "home.greeting.next",
  "home.greeting.begin",
  "home.greeting.dig",
  "home.greeting.anything",
]);

export function pickRandomGreeting(): string {
  const index = Math.floor(Math.random() * LANDING_GREETING_KEYS.length);
  return t(LANDING_GREETING_KEYS[index]);
}
