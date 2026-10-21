import { applyLanguage } from "@/i18n";
import {
  NOTIFICATION_SOUNDS,
  getNotificationSoundOptions,
  isNotificationSoundId,
} from "@/utils/notificationSoundCatalog";

describe("notificationSoundCatalog", () => {
  describe("isNotificationSoundId()", () => {
    it("accepts every catalog id and rejects anything else", () => {
      for (const id of Object.keys(NOTIFICATION_SOUNDS)) {
        expect(isNotificationSoundId(id)).toBe(true);
      }
      expect(isNotificationSoundId("removed-sound")).toBe(false);
      expect(isNotificationSoundId(undefined)).toBe(false);
    });

    it("rejects inherited property names from persisted data (https://github.com/logancyang/obsidian-copilot/issues/2987)", () => {
      expect(isNotificationSoundId("toString")).toBe(false);
      expect(isNotificationSoundId("constructor")).toBe(false);
      expect(isNotificationSoundId("__proto__")).toBe(false);
    });
  });

  describe("getNotificationSoundOptions()", () => {
    afterEach(() => {
      applyLanguage("en", []);
    });

    it("offers one labeled option per catalog sound", () => {
      applyLanguage("en", []);
      expect(getNotificationSoundOptions()).toEqual(
        Object.keys(NOTIFICATION_SOUNDS).map((value) => ({
          label: NOTIFICATION_SOUNDS[value as keyof typeof NOTIFICATION_SOUNDS].label,
          value,
        }))
      );
    });

    it("labels the options in the active language", () => {
      applyLanguage("zh-CN", []);
      expect(getNotificationSoundOptions()).toContainEqual({ label: "钢琴键", value: "piano" });
      expect(getNotificationSoundOptions()).toContainEqual({ label: "门铃", value: "doorbell" });
    });
  });
});
