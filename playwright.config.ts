import { defineConfig } from "playwright";

export default defineConfig({
    timeout: 30_000,
    use: {
        channel: "chrome",
        headless: false,
    },
});
