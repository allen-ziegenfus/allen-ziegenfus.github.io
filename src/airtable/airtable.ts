export async function listOverviewRecords() {
    return listRecords(process.env.BASE_ID!, process.env.TABLE_NAME!);
}

export async function listPageRecords() {
    return listRecords(process.env.BASE_ID!, "Seiten");
}

export async function listRecords(baseId: string, tableName: string) : Promise< {id: string, fields: { [key: string]: any}}[]>{  
    console.log(`Listing records in base ${baseId} table ${tableName}`);
    const records = [];

    let allRecordsFetched = false;
    const base_uri = `https://api.airtable.com/v0/${baseId}/${tableName}`;
    let uri = base_uri;

    while (!allRecordsFetched) {
        const fetchresponse = await fetch(uri, {
            method: 'GET',
            headers: { Authorization: `Bearer ${process.env.ACCESS_TOKEN}`, 'Content-Type': 'application/json charset=utf-8;' },
        });

        if (fetchresponse.status != 200) {
            console.error(fetchresponse);
        }

        const response = await fetchresponse.json();

        records.push(...response.records);

        if (response && response.offset) {
            uri = base_uri + `?offset=${response.offset}`;
        } else {
            allRecordsFetched = true;
        }
    }

    console.log(`${records.length} records found in table ${tableName}`)
    return records;
}
