import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import { remarkPublishedDocs } from "./src/remark-published-docs.mjs";

export default defineConfig({
  markdown: { remarkPlugins: [remarkPublishedDocs] },
  integrations: [
    starlight({
      title: "Vault Agent",
      markdown: { processedDirs: ["."] },
      sidebar: [
        { label: "开始使用", items: [{ slug: "" }, { slug: "agent-mode-and-tools" }] },
        {
          label: "模型与设置",
          items: [{ slug: "settings" }, { slug: "agent-mode-windows-setup" }],
        },
        {
          label: "笔记与工作方式",
          items: [
            { slug: "projects" },
            { slug: "custom-commands" },
            { slug: "system-prompts" },
            { slug: "agents-md-examples" },
            { slug: "vault-search-and-indexing" },
          ],
        },
        { label: "帮助", items: [{ slug: "troubleshooting-and-faq" }] },
      ],
    }),
  ],
});
