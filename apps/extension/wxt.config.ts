import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  imports: false,
  manifest: {
    name: "TagMark",
    description: "Save and organize your bookmarks.",
    permissions: ["activeTab"],
  },
});
