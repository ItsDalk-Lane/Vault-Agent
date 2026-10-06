import { t } from "../../i18n";
import type { App } from "obsidian";
import { SecretComponent, Setting } from "obsidian";

interface ProviderSecretOptions {
	value: string;
	onChange: (value: string) => void;
	hasLegacyKey?: boolean;
}

export function addProviderSecret(
	container: HTMLElement,
	app: App,
	options: ProviderSecretOptions,
): Setting {
	return configureProviderSecret(new Setting(container), app, options);
}

/** Turn `setting` into the provider's API key row. */
export function configureProviderSecret(
	setting: Setting,
	app: App,
	options: ProviderSecretOptions,
): Setting {
	return setting
		.setName(t("ai.apiKey.name"))
		.setDesc(options.hasLegacyKey
			? t("ai.apiKey.legacyDesc")
			: t("ai.apiKey.desc"))
		.addComponent((el) => new SecretComponent(app, el)
			.setValue(options.value)
			.onChange(options.onChange));
}
