import { listRecords, listPageRecords } from '../airtable/airtable.js';
import * as fs from "fs";
import * as dotenv from 'dotenv';
import { slugify } from './slugify.js';
import { marked } from 'marked';


dotenv.config()

async function getPages() {
  const pages = [];
  const pageRecords = await listPageRecords();
  for (const pageRecord of pageRecords) {

    try {
      const individualPageRecords = await listRecords(process.env.BASE_ID, pageRecord.fields.Table);
      const reihenfolge = pageRecord.fields.Reihenfolge;
      const page = {};
      const processedPageRecords = []
      let isTable = false;
      for (const individualPageRecord of individualPageRecords) {
        const processedPageRecord = {};
        for (const field in individualPageRecord.fields) {
          if (field === 'Text') {
            processedPageRecord[field] = marked.parse(individualPageRecord.fields[field]);
          } else {
            processedPageRecord[field] = individualPageRecord.fields[field];
          }
          if (field === 'Spalte1') { isTable = true }
        }
        if (processedPageRecord["Reihenfolge"]) {
        processedPageRecords.push(processedPageRecord);
        }

      }
      
      page["Name"] = pageRecord.fields.Table;
      page["Records"] = processedPageRecords.sort((a, b) => a?.Reihenfolge ? a?.Reihenfolge - b?.Reihenfolge : 0);;
      page["Slug"] = `${slugify(pageRecord.fields.Table, { lower: true })}`;
      page["isTable"] = isTable;
      page["Reihenfolge"] = reihenfolge;
      page["Kategorie"] = pageRecord.fields.Kategorie;
      pages.push(page);
    }
    catch (error) {
      console.log("error fetching records", error)
    }
  }

  pages.sort((a, b) => a.Reihenfolge - b.Reihenfolge);
  await fs.promises.writeFile("./public/pages.json", JSON.stringify(pages));
}

await getPages();