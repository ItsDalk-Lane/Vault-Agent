import type {
	Setting,
	SettingDefinitionGroup,
	SettingDefinitionList,
	SettingDefinitionPage,
} from "obsidian";
import type { QuickAddSettings } from "../../settings";
import { createDocsLink, DOCS_URLS, openDocsUrl } from "../../docs";
import { t } from "../../i18n";

/** Declarative control keys for fields nested under `ai` (see the tab's store bridge). */
export type AISettingsKey = `ai.${Extract<
	keyof QuickAddSettings["ai"],
	"showAssistant" | "confirmToolCalls" | "promptTemplatesFolderPath"
>}`;
export type SettingsKey = Extract<keyof QuickAddSettings, string> | AISettingsKey;
export function packagesDesc(): string {
	return t("settings.packages.desc");
}

type SettingsRenderers = Record<
	| "choices"
	| "packages"
	| "dateAliases"
	| "globalVariables"
	| "developmentInfo",
	(setting: Setting) => void | (() => void)
>;

export function createSettingDefinitions(
	render: SettingsRenderers,
	isDevBuild: boolean,
	aiAssistantPage?: SettingDefinitionPage<SettingsKey>,
	templateFolders?: SettingDefinitionGroup<SettingsKey> | SettingDefinitionList<SettingsKey>,
): SettingDefinitionGroup<SettingsKey>[] {
	const groups: SettingDefinitionGroup<SettingsKey>[] = [
		{
			type: "group",
			heading: t("settings.group.choicesAndPackages"),
			// QuickAdd's power surface is syntax you have to learn ({{VALUE}},
			// {{DATE}}, capture targets, ...) and until now the manual was reachable
			// from exactly one place in the whole plugin (issue #1541). A help icon
			// on the first heading is Obsidian's own idiom for this, and it costs the
			// page no vertical space, so the choices list stays the focus.
			extraButtons: [
				(button) =>
					button
						.setIcon("help-circle")
						.setTooltip(t("settings.docs.quickAddTooltip"))
						.onClick(() =>
							openDocsUrl(DOCS_URLS.gettingStarted, button.extraSettingsEl),
						),
			],
			items: [
				{
					name: t("settings.choices.name"),
					render: render.choices,
				},
				{
					name: t("settings.packages.name"),
					desc: packagesDesc(),
					render: render.packages,
				},
			],
		},
		{
			type: "group",
			heading: t("settings.group.input"),
			items: [
				{
					name: t("settings.items.useMultiLine.name"),
					desc: t("settings.items.useMultiLine.desc"),
					control: { type: "toggle", key: "inputPrompt" },
				},
				{
					name: t("settings.items.onePageInput.name"),
					// The trailing sentence used to read "See One-page Inputs in the
					// docs." as plain, unlinked prose (issue #1541).
					desc: descWithDocsLink(
						t("settings.items.onePageInput.descPrefix"),
						DOCS_URLS.onePageInputs,
						t("settings.docs.learnMoreAboutOnePageInput"),
					),
					control: { type: "toggle", key: "onePageInputEnabled" },
				},
			],
		},
		...(templateFolders ? [templateFolders] : []),
		{
			type: "group",
			heading: t("settings.group.notifications"),
			items: [
				{
					name: t("settings.items.announceUpdates.name"),
					desc: t("settings.items.announceUpdates.desc"),
					control: {
						type: "dropdown",
						key: "announceUpdates",
						defaultValue: "major",
						options: {
							all: t("settings.items.announceUpdates.all"),
							major: t("settings.items.announceUpdates.major"),
							none: t("settings.items.announceUpdates.none"),
						},
					},
				},
				{
					name: t("settings.items.showCaptureNotifications.name"),
					desc: t("settings.items.showCaptureNotifications.desc"),
					control: { type: "toggle", key: "showCaptureNotification" },
				},
			],
		},
		{
			type: "group",
			heading: t("settings.group.aiAndOnline"),
			items: [
				{
					name: t("settings.items.disableAI.name"),
					desc: t("settings.items.disableAI.desc"),
					control: { type: "toggle", key: "disableOnlineFeatures" },
				},
				...(aiAssistantPage ? [aiAssistantPage] : []),
			],
		},
		{
			type: "group",
			heading: t("settings.appearance.heading"),
			items: [
				{
					name: t("settings.appearance.ribbonIconName"),
					desc: t("settings.appearance.ribbonIconDesc"),
					control: { type: "toggle", key: "enableRibbonIcon" },
				},
			],
		},
		{
			type: "group",
			items: [advancedPage(render)],
		},
	];
	if (isDevBuild) {
		groups.push({
			type: "group",
			heading: t("settings.group.developer"),
			items: [
				{
					name: t("settings.items.development.name"),
					desc: t("settings.items.development.desc"),
					render: render.developmentInfo,
				},
			],
		});
	}
	return groups;
}

/**
 * Settings most vaults never change (#2017), kept one level down so the main
 * tab stays short. Settings search still finds them.
 */
function advancedPage(render: SettingsRenderers): SettingDefinitionPage<SettingsKey> {
	return {
		type: "page",
		name: t("settings.advanced.name"),
		items: [
			{
				type: "group",
				heading: t("settings.group.choicePicker"),
				items: [
					{
						name: t("settings.items.templateFolderLauncherRow.name"),
						desc: t("settings.items.templateFolderLauncherRow.desc"),
						control: {
							type: "dropdown",
							key: "templateFolderLauncherRow",
							defaultValue: "bottom",
							options: {
								bottom: t("settings.items.templateFolderLauncherRow.bottom"),
								top: t("settings.items.templateFolderLauncherRow.top"),
								off: t("settings.items.templateFolderLauncherRow.off"),
							},
						},
					},
					{
						name: t("settings.items.searchNestedChoices.name"),
						// "Multi" is the internal type id; every other user-facing string
						// says folder (see src/utils/choiceNoun.ts).
						desc: t("settings.items.searchNestedChoices.desc"),
						control: { type: "toggle", key: "searchNestedChoices" },
					},
				],
			},
			{
				type: "group",
				heading: t("settings.group.input"),
				items: [
					{
						name: t("settings.items.useSelection.name"),
						desc: t("settings.items.useSelection.desc"),
						control: { type: "toggle", key: "useSelectionAsCaptureValue" },
					},
					{
						name: t("settings.items.namePastedImages.name"),
						desc: t("settings.items.namePastedImages.desc"),
						control: { type: "toggle", key: "namePastedImagesAfterNoteTitle" },
					},
					{
						name: t("settings.items.persistDrafts.name"),
						desc: t("settings.items.persistDrafts.desc"),
						control: { type: "toggle", key: "persistInputPromptDrafts" },
					},
					{
						name: t("settings.items.dateAliases.name"),
						desc: t("settings.items.dateAliases.desc"),
						render: render.dateAliases,
					},
				],
			},
			{
				type: "group",
				heading: t("settings.group.notifications"),
				items: [
					{
						name: t("settings.items.showInputCancellation.name"),
						desc: t("settings.items.showInputCancellation.desc"),
						control: {
							type: "toggle",
							key: "showInputCancellationNotification",
						},
					},
				],
			},
			{
				type: "group",
				heading: t("settings.group.properties"),
				items: [
					{
						name: t("settings.items.convertStringTypes.name"),
						desc: t("settings.items.convertStringTypes.desc"),
						control: { type: "toggle", key: "enableTemplatePropertyTypes" },
					},
				],
			},
			{
				type: "group",
				heading: t("settings.group.globalVariables"),
				items: [
					{
						name: t("settings.items.globalVariables.name"),
						render: render.globalVariables,
					},
				],
			},
			{
				type: "group",
				heading: t("settings.group.uri"),
				items: [
					{
						name: t("settings.items.allowUriCallbacks.name"),
						desc: t("settings.items.allowUriCallbacks.desc"),
						control: { type: "toggle", key: "enableUriCallbacks" },
					},
				],
			},
		],
	};
}

/** Create a fresh fragment for each native setting render. */
export function descWithDocsLink(
	text: string,
	url: string,
	linkText = t("settings.docs.learnMore"),
): DocumentFragment {
	const fragment = createFragment();
	fragment.append(document.createTextNode(text));
	createDocsLink(fragment, url, linkText);
	return fragment;
}
