import { listOverviewRecords, listRecords } from '../airtable/airtable';
import slugify from "slugify"
//import.meta.env.DEV

let werkgruppen: {
    Titel: string; Slug: string; Thumbnail: any; Count: number; Records: {
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
        Thumbnail: URL

    }[];
}[] = [];

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
            Slug:  slugify(record.fields["Inv. Nr."], {lower: true}),
            Anzahl: record.fields.Anzahl,
            Werkgruppe: record.fields.Werkgruppe,
            Maße: record.fields.Maße,
            Material: record.fields.Material,
            Beschreibung: record.fields.Beschreibung,
            Jahr: record.fields.Jahr,
            Zustand: record.fields.Zustand,
            Standort: record.fields.Standort,
            Titel: record.fields.Titel,
            Signatur: record.fields.Signatur,
            Bilder: record.fields?.Bild?.map((bild: { thumbnails: { large: { url: any; }; }; }) =>  bild?.thumbnails?.large?.url),
            Thumbnail: getSmallThumbnailURL(record.fields?.Bild?.slice(0, 1)[0]),
            
        })));

        werkgruppenTemp.push({
            Titel: overviewRecord.fields.Titel,
            Slug: overviewRecord.fields.Slug,
            Thumbnail: getSmallThumbnailURL(overviewRecord.fields.Bild.slice(0, 1)[0]),
            Count: werkGruppenRecords.length,
            Records: records
        })
    }

    werkgruppen = werkgruppenTemp;
    return werkgruppen;
}

function getSmallThumbnailURL(attachment: any) {
    return attachment?.thumbnails?.large?.url;
}
