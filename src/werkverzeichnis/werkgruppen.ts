import { listOverviewRecords, listRecords, listPageRecords } from '../airtable/airtable.js';
import * as dotenv from 'dotenv'
import * as fs from "fs";
import axios from "axios";
import sharp, { bool } from "sharp";
import { finished } from "node:stream/promises"
import { slugify } from './slugify.js';
dotenv.config()

console.log("Downloading airtable assets");

export type Work = {
  id: string,
  InvNr: string,
  InventoryNumber: number,
  WerkgruppeSlug: string,
  Slug: string,
  Anzahl: string,
  Werkgruppe: string,
  Maße: string,
  Material: string,
  Beschreibung: string,
  Jahr: string,
  Zustand: string,
  Standort: string,
  Titel: string,
  Signatur: string,
  Bilder: any[],
  Thumbnail: string,
  Technik: string,
  Auflage: string,
  Foto: string,
  Ausstellung: string,
  Literatur: string,
  Bibliographie: string
}

export type Workgroup = {
  Titel: string; Slug: string; Thumbnail: any; Count: number; Records: Work[]; Reihenfolge: number;
}
let werkgruppen: Workgroup[] = [];

async function getBilder(Bild: any, slug: string) {

  if (!Bild) {
    return ["/placeholder.png"];
  }

  const Bilder = [];
  let index = 1;
  for (const bild of Bild) {
    Bilder.push(await getAttachmentURL(bild, slug, index++));
  }
  return Bilder;
}
async function getPages() {
  const pages = [];
  const pageRecords = await listPageRecords();
  for (const pageRecord of pageRecords) {

    try {
      const individualPageRecords = await listRecords(process.env.BASE_ID, pageRecord.fields.Table);
      const reihenfolge = pageRecord.fields.Reihenfolge;
      const page = {};
      const pageRecords = []
      let isTable = false;
      for (const individualPageRecord of individualPageRecords) {
        const pageRecord = {};
        for (const field in individualPageRecord.fields) {
            pageRecord[field] = individualPageRecord.fields[field]; 
            if (field === 'Spalte1') { isTable = true}
        }
        pageRecords.push(pageRecord);

      }
      pageRecords.sort((a, b) => a?.Reihenfolge ? a?.Reihenfolge - b?.Reihenfolge : 0);
      page["Name"] = pageRecord.fields.Table;
      page["Records"] = pageRecords;
      page["Slug"] = `${slugify(pageRecord.fields.Table, {lower: true})}`;
      page["isTable"] = isTable;
      page["Reihenfolge"] = reihenfolge;
      pages.push(page);
    }
    catch (error) {
      console.log("error fetching records", error)
    }
  }

  pages.sort((a, b) => a.Reihenfolge - b.Reihenfolge);
  await fs.promises.writeFile("./public/pages.json", JSON.stringify(pages));
}
async function performGetWerkgruppen() {

  await fs.promises.mkdir("./public/images", { recursive: true })
  await fs.promises.mkdir("./build/images/originals", { recursive: true })
  await fs.promises.mkdir("./dist/images", { recursive: true })
  if (werkgruppen.length > 0) {
    console.log("Returning already fetched records");
    return werkgruppen;
  }

  try {
    let werkgruppenTemp: Workgroup[] = [];

    const overviewRecords = await listOverviewRecords();
    for (const overviewRecord of overviewRecords) {
      try {
        const werkGruppenRecords = await listRecords(overviewRecord.fields.Base, overviewRecord.fields.Table)

        const filteredWerkgruppenRecords = werkGruppenRecords.filter(record =>
          record.fields && record.fields["Inv. Nr."]);

        const records: Work[] = [];
        for (const record of filteredWerkgruppenRecords) {
          const slug = slugify(record.fields["Inv. Nr."], { lower: true });
          const bilder = await getBilder(record.fields?.Bild, slug);
          const work: Work =
          {
            id: record.id,
            InvNr: record.fields["Inv. Nr."],
            InventoryNumber: record.fields["Inv. Nr."].replaceAll(/[^0-9]/g, ''),
            Slug: slug,
            WerkgruppeSlug: overviewRecord.fields.Slug,
            Anzahl: record.fields.Anzahl,
            Werkgruppe: record.fields.Werkgruppe,
            Maße: record.fields.Maße,
            Material: record.fields.Material,
            Beschreibung: record.fields.Beschreibung,
            Jahr: record.fields.Jahr,
            Zustand: record.fields.Zustand,
            Standort: record.fields.Standort,
            Titel: record.fields.Titel,
            Technik: record.fields.Technik,
            Auflage: record.fields.Auflage,
            Signatur: record.fields.Signatur,
            Foto: record.fields.Foto,
            Ausstellung: record.fields.Ausstellung,
            Literatur: record.fields.Literatur,
            Bibliographie: record.fields.Bibliographie,
            Bilder: bilder,
            Thumbnail: bilder[0]
          };
          records.push(work);
        }

        console.log("Finished getting", overviewRecord);

        records.sort((a, b) => a.InventoryNumber - b.InventoryNumber);
        werkgruppenTemp.push({
          Titel: overviewRecord.fields.Titel,
          Slug: overviewRecord.fields.Slug,
          Thumbnail: await getAttachmentURL(overviewRecord.fields.Bild.slice(0, 1)[0], overviewRecord.fields.Slug, 1),
          Count: werkGruppenRecords.length,
          Records: records,
          Reihenfolge: overviewRecord.fields.Reihenfolge
        })
      } catch (error) {
        console.log("error fetching records", error)
      }
    }
    werkgruppenTemp.sort((a, b) => a.Reihenfolge - b.Reihenfolge);

    werkgruppen = werkgruppenTemp;

    let records: Work[] = [];

    werkgruppen.forEach(
      (workgroup) => (records = records.concat(workgroup.Records))
    );
    await fs.promises.writeFile("./public/records.json", JSON.stringify(records));
    await fs.promises.writeFile("./public/werkgruppen.json", JSON.stringify(werkgruppen));

  } catch (error) {
    console.log(`Error getting work groups: ${error}`);
  }

  return werkgruppen;
}


const werkgruppenPromise = performGetWerkgruppen();

await getPages();
await werkgruppenPromise;

export async function getWerkgruppen() {
  return werkgruppenPromise;
}

async function imageDownloaded(filepath: string) {
  try {
    const filepathstat = await fs.promises.stat(filepath);
    if (filepathstat.isFile() && filepathstat.size > 0) {
      return true;
    }
  } catch (error) {
    return false;
  }
}
async function downloadFile(url: string, filepath: string): Promise<void> {
  console.log(`Downloading ${url} to ${filepath} as it does not currently exist`)
  const writer = fs.createWriteStream(filepath);

  const response = await axios.get(url, { responseType: "stream" });
  if (response.status !== 200) {
    throw `error downloading ${url}`;
  }
  response.data.pipe(writer);
  return finished(writer);
};

async function getAttachmentURL(attachment: any, slug: string, index: number) {
  let url = "/placeholder.png";
  const base_filename = `${slug}-${String(index).padStart(2, '0')}`;
  if (attachment?.thumbnails?.large?.url) {
    const downloadpath = `./build/images/${attachment.filename}`;
    const new_filename = `images/${base_filename}.webp`
    try {
      let imageExists = await imageDownloaded(downloadpath);
      while (!imageExists) {
        try {
          await downloadFile(attachment?.thumbnails?.large?.url, downloadpath)
        } catch (error) {
          console.log(`Axios download for ${downloadpath} failed - trying again: ${error}`)
        }
        imageExists = await imageDownloaded(downloadpath);
      }

      const webppath = `./public/${new_filename}`;
      imageExists = await imageDownloaded(webppath);
      while (!imageExists) {
        try {
          console.log(`Converting ${downloadpath} to webp ${webppath}`);
          await sharp(downloadpath).webp().toFile(webppath);
        }
        catch (error) {
          console.log(`Error converting ${attachment?.thumbnails?.large?.url}  ${downloadpath} to ${webppath}: ${error}`)
        }
        imageExists = await imageDownloaded(downloadpath);
      }
    }
    catch (error) {
      console.log("error", error);
      return url;
    }
    return `/${new_filename}`;
  }
  return url;
}
/*
{
  id: 'attL8S3hiYQu4X5Ol',
  width: 800,
  height: 500,
  url: 'https://v5.airtableusercontent.com/v1/16/16/1682359200000/xttwZbUe9A4J2PPvBaecHA/437eqYAp1IcxPs48c_EvX-X0JQcW0grf6Noc21FUuaaIk8wfDy3jW46RrGYfwAx3RgYgZKEb5B7YjI9y99mr7UtNzMV-bkbkonxTLpuUpcm3ESdDJBwMugL12nolHFA0QGDZw1hrzUkTgj8RxopE_Q/qyHuz0p6AeByzJKqOHbV9nUlO96y8fJJZGPCsqt_8_4',
  filename: 'video_9653f11f4c4cd360e505d6edc75b3374.png',
  size: 139621,
  type: 'image/png',
  thumbnails: {
    small: {
      url: 'https://v5.airtableusercontent.com/v1/16/16/1682359200000/uY6yeAb2QRJUrB7sW2FUeg/ydHsnDj46UJHRgqy9T6yuJuducngyQH_LOzJvf5x31QPn9jCCbAyymTcwQhoxhPWDvxodmuAILsXGMfNRDDBbQ/_InmqvlZWHGphVp4PfbHl6wj92azDWm1rve2Gb9BbBM',
      width: 58,
      height: 36
    },
    large: {
      url: 'https://v5.airtableusercontent.com/v1/16/16/1682359200000/5dv5362dhbTj2f189CVFbw/3wuWgyxEl_Mr6_R74CauoN5gbLH32gLVN9qp1rGbCmhE3gp29ZP0uABH_QMC-3tFvouqs-FS1rdFx3JAZTcDEw/7v6EP2UTUY7NMd9y2s0W4AcvMcvS_ECOwkrX3FOppZM',
      width: 800,
      height: 500
    },
    full: {
      url: 'https://v5.airtableusercontent.com/v1/16/16/1682359200000/rFJA_CiQd2XZh2J0f3PZNA/6ZEKk39pWoDsGm-ZINzGil05yCg-SikiP_DtxMVnc1P9Rg-KpFW6ltXY03Bv7pO5P9LJP9U-j1fjGFqb_HMm3Q/B0ME3g9ufsHTk2wu-HfGQbsr85ZIjagQStqf6o0281w',
      width: 3000,
      height: 3000
    }
  }
}*/