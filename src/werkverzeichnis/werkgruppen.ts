import { listOverviewRecords, listRecords } from '../airtable/airtable';
import slugify from "slugify"
import { importRemoteImage } from "astro-imagetools/api";
//import.meta.env.DEV

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

export async function getWerkgruppen() {
    if (werkgruppen.length > 0) {
        console.log("Returning already fetched records");
        return werkgruppen;
    }

    let werkgruppenTemp = [];
    const overviewRecords = await listOverviewRecords();
    for (const overviewRecord of overviewRecords) {
        const werkGruppenRecords = await listRecords(overviewRecord.fields.Base, overviewRecord.fields.Table)

        const records = werkGruppenRecords?.map((record =>
        ({
            id: record.id,
            InvNr: record.fields["Inv. Nr."],
            InventoryNumber: record.fields["Inv. Nr."].replaceAll(/[^0-9]/g, ''),
            Slug: slugify(record.fields["Inv. Nr."], { lower: true }),
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
            Bilder: record.fields?.Bild?.map((bild: { thumbnails: { large: { url: any; }; }; }) => bild?.thumbnails?.large?.url),
            Thumbnail: getSmallThumbnailURL(record.fields?.Bild?.slice(0, 1)[0]),
        })));

        records.sort((a, b) => a.InventoryNumber - b.InventoryNumber);
        werkgruppenTemp.push({
            Titel: overviewRecord.fields.Titel,
            Slug: overviewRecord.fields.Slug,
            Thumbnail: getSmallThumbnailURL(overviewRecord.fields.Bild.slice(0, 1)[0]),
            Count: werkGruppenRecords.length,
            Records: records,
            Reihenfolge: overviewRecord.fields.Reihenfolge
        })
    }
    werkgruppenTemp.sort((a, b) => a.Reihenfolge - b.Reihenfolge);

    werkgruppen = werkgruppenTemp;
    return werkgruppen;
}

function getSmallThumbnailURL(attachment: any) {
    return attachment?.thumbnails?.large?.url || "/placeholder.png";
}
