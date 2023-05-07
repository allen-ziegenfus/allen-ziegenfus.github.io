import { defineConfig } from 'astro/config';
import tailwind from "@astrojs/tailwind";
import { astroImageTools } from "astro-imagetools";

import react from "@astrojs/react";

// https://astro.build/config
export default defineConfig({
  integrations: [tailwind(), astroImageTools, react()],
  site: 'https://allen-ziegenfus.github.com'
});