import { defineConfig } from 'astro/config';
import tailwind from "@astrojs/tailwind";
import { astroImageTools } from "astro-imagetools";
import react from "@astrojs/react";
import * as dotenv from 'dotenv';
dotenv.config()
import sitemap from "@astrojs/sitemap";

// https://astro.build/config
export default defineConfig({
  integrations: [tailwind(), astroImageTools, react(), sitemap()],
  //site: 'https://werkverzeichnis.vollrad-kutscher.de'
  site: process.env.SITE
});