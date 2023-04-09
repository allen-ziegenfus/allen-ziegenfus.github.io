import { listOverviewRecords, listRecords } from '../airtable/airtable';
//import.meta.env.DEV

let werkgruppen: { Titel: any; Slug: any; Thumbnail: any; Count: number; Records: any[]; }[] = [];

export async function getWerkgruppen() {
    if (werkgruppen.length > 0) {
        console.log("Returning already fetched records");
        return werkgruppen;        
    }

    let werkgruppenTemp = [];
    const overviewRecords = await listOverviewRecords();
    for (const overviewRecord of overviewRecords) {
        const werkGruppenRecords = await listRecords(overviewRecord.fields.Base, overviewRecord.fields.Table)

        werkgruppenTemp.push({
            Titel: overviewRecord.fields.Titel,
            Slug: overviewRecord.fields.Slug,
            Thumbnail: getSmallThumbnailURL(overviewRecord.fields.Bild.slice(0, 1)[0]),
            Count: werkGruppenRecords.length,
            Records: werkGruppenRecords
        })
    }

    werkgruppen = werkgruppenTemp;
    return werkgruppen;
}

function getSmallThumbnailURL(attachment: any) {
    return attachment?.thumbnails?.large?.url;
}
