import { listRecords, listPageRecords } from '../airtable/airtable.js';
import * as fs from "fs";
import * as dotenv from 'dotenv';
import { slugify } from './slugify.js';

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
              processedPageRecord[field] = individualPageRecord.fields[field]; 
              if (field === 'Spalte1') { isTable = true}
          }
          processedPageRecords.push(processedPageRecord);
  
        }
        processedPageRecords.sort((a, b) => a?.Reihenfolge ? a?.Reihenfolge - b?.Reihenfolge : 0);
        page["Name"] = pageRecord.fields.Table;
        page["Records"] = processedPageRecords;
        page["Slug"] = `${slugify(pageRecord.fields.Table, {lower: true})}`;
        page["isTable"] = isTable;
        page["Reihenfolge"] = reihenfolge;
        page["Kategorie"]= pageRecord.fields.Kategorie;
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