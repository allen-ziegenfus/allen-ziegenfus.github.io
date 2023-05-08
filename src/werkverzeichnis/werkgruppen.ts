import { listOverviewRecords, listRecords } from '../airtable/airtable';
import slugify from "slugify"
import fs from "fs";
import https from "https";
import sharp from "sharp";
export type Work = {
    id: string,
    InvNr: string,
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
    Bilder: [],
    Thumbnail: URL,
    Technik: string,
    Auflage: string,
    Foto: string,
    Ausstellung: string,
    Literatur: string,
    Bibliographie: string
}

export type Workgroup = {
    Titel: string; Slug: string; Thumbnail: any; Count: number; Records: Work[]
}
let werkgruppen: Workgroup[] = [];

async function getBilder(Bild) {

  if (!Bild) {
    return [ "/placeholder.png"];
  }
  return await Promise.all(Bild.map((async bild => await getAttachmentURL(bild))));
}
async function performGetWerkgruppen() {
    await fs.promises.mkdir("./public/images", {recursive: true})
    await fs.promises.mkdir("./dist/images", {recursive: true})
    if (werkgruppen.length > 0) {
        console.log("Returning already fetched records");
        return werkgruppen;
    }

    let werkgruppenTemp = [];
    const overviewRecords = await listOverviewRecords();
    for (const overviewRecord of overviewRecords) {
        try {
          const werkGruppenRecords = await listRecords(overviewRecord.fields.Base, overviewRecord.fields.Table)

          const filteredWerkgruppenRecords = werkGruppenRecords.filter(record => 
            record.fields && record.fields["Inv. Nr."])          ;
          const records =  await Promise.all(filteredWerkgruppenRecords?.map((async record =>
          ({
              id: record.id,
              InvNr: record.fields["Inv. Nr."],
              InventoryNumber: record.fields["Inv. Nr."].replaceAll(/[^0-9]/g, ''),
              Slug: slugify(record.fields["Inv. Nr."], { lower: true }),
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
              Bilder: await getBilder(record.fields?.Bild),
              Thumbnail: await getAttachmentURL(record.fields?.Bild?.slice(0, 1)[0]),
          }))));

          records.sort((a, b) => a.InventoryNumber - b.InventoryNumber);
          werkgruppenTemp.push({
              Titel: overviewRecord.fields.Titel,
              Slug: overviewRecord.fields.Slug,
              Thumbnail: await getAttachmentURL(overviewRecord.fields.Bild.slice(0, 1)[0]),
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

    let records = [];

    werkgruppen.forEach(
        (workgroup) => (records = records.concat(workgroup.Records))
    );
    await fs.promises.writeFile("./public/records.json", JSON.stringify(records));
    await fs.promises.writeFile("./dist/records.json", JSON.stringify(records));


    return werkgruppen;
}

const werkgruppenPromise = performGetWerkgruppen();

export async function getWerkgruppen() {
  return werkgruppenPromise;
}

const downloadFile = async (url, filepath, onSuccess, onError) => {
    
    try {
      const filepathstat = await fs.promises.stat(filepath);
      if (filepathstat.isFile()) {
        return;
      }
    } catch (error) {
      console.log(`Downloading ${url} to ${filepath} as it does not currently exist`)
    }
    const pipeline = sharp();
    pipeline.webp().toFile(filepath);

    return new Promise((resolve, reject) => 
    https
    .get(url, response => {
      response.pipe(pipeline);
      pipeline.on("finish", () => {
        resolve(true);
      });
    })
    .on("error", fileErr => {
      console.log(fileErr);
      fs.unlink(filepath, error => onError && onError(error));
      reject(fileErr);
    }));
  };

async function getAttachmentURL(attachment: any) {
    let url = "/placeholder.png";
    if ( attachment?.thumbnails?.large?.url) {
        const new_filename = `images/${attachment.id}.webp`
        try {
          await downloadFile(attachment?.thumbnails?.large?.url, `./public/${new_filename}`, () => {}, () => {})
          await fs.promises.copyFile( `./public/${new_filename}`,  `./dist/${new_filename}`)
        }
        catch (error) {
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