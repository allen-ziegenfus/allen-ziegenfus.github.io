/**
 * Data checks for the Werkverzeichnis sheet, run from the editor's own menu.
 *
 * These mirror the checks in src/werkverzeichnis/sheets.ts so that a problem is
 * found while someone is looking at the row, rather than thirty minutes later in
 * a failed build. sheets.ts remains authoritative — it is what actually blocks a
 * publish under STRICT=1. If the two ever disagree, sheets.ts is right and this
 * file is stale.
 *
 * Covered here (4 of the 6 checks in sheets.ts, plus the column check):
 *   - rows that are an imported header row
 *   - rows with no Inv. Nr.
 *   - two rows that slugify to the same URL
 *   - one slug that is a filename prefix of another
 *   - blank or unrecognised column headers
 *   - a Werkgruppe with no cover image
 *
 * Not covered — both need the Drive folder, which this does not read:
 *   - images that match no row
 *   - a row whose image is missing or undecodable (the .pdf case)
 *
 * Results go to a generated _Prüfung tab. Nothing in the data tabs is modified.
 */

// The canonical column set, from tools/make_sheets_csv.py.
var COLUMNS = ["Inv. Nr.", "Titel", "Werkgruppe", "Jahr", "Maße", "Material",
               "Technik", "Beschreibung", "Zustand", "Standort", "Signatur",
               "Auflage", "Anzahl", "Foto", "Ausstellung", "Literatur",
               "Bibliographie"];

var REPORT = "_Prüfung";

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Werkverzeichnis")
    .addItem("Daten prüfen", "checkData")
    .addToUi();
}

function checkData() {
  var ss = SpreadsheetApp.getActive();
  var problems = [];

  var overview = readTab(ss, "_Übersicht");
  if (!overview) {
    SpreadsheetApp.getUi().alert('Tab "_Übersicht" not found.');
    return;
  }

  overview.rows.forEach(function (row) {
    if (!cell(row.values["Bild"])) {
      problems.push(mk("_Übersicht", row.line, row.values["Slug"] || "",
        "no cover image for " + (row.values["Slug"] || "this Werkgruppe")));
    }
  });

  overview.rows.forEach(function (g) {
    var tab = cell(g.values["Tab"]);
    if (!tab) return;
    var sheet = readTab(ss, tab);
    if (!sheet) {
      problems.push(mk("_Übersicht", g.line, tab,
        'tab "' + tab + '" is listed in _Übersicht but does not exist'));
      return;
    }
    checkColumns(sheet, problems);
    checkRows(sheet, problems);
  });

  writeReport(ss, problems);
}

/** Read one tab as display values — the same strings the build's FORMATTED_VALUE sees. */
function readTab(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) return null;
  var values = sheet.getDataRange().getDisplayValues();
  if (!values.length) return null;
  var header = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var blank = values[i].every(function (v) { return String(v).trim() === ""; });
    if (blank) continue;
    var obj = {};
    for (var c = 0; c < header.length; c++) obj[header[c]] = values[i][c];
    rows.push({ line: i + 1, values: obj });   // 1-based, and row 1 is the header
  }
  return { name: name, header: header, rows: rows };
}

var cell = function (v) {
  return v !== undefined && String(v).trim() !== "" ? String(v) : null;
};

function mk(tab, line, inv, message) {
  return { tab: tab, line: line, inv: inv, message: message };
}

/**
 * A blank header silently drops its whole column — this is how `Anzahl` went
 * missing from 23 records on the way into Airtable, so it is worth its own check.
 */
function checkColumns(sheet, problems) {
  sheet.header.forEach(function (h, i) {
    var col = i + 1;
    if (String(h).trim() === "") {
      // Trailing empty columns are just unused width, not a dropped column.
      var used = sheet.rows.some(function (r) { return cell(r.values[h]); });
      if (used) {
        problems.push(mk(sheet.name, 1, "",
          "column " + col + " has a blank header, so its values are dropped"));
      }
    } else if (COLUMNS.indexOf(String(h).trim()) === -1) {
      problems.push(mk(sheet.name, 1, "",
        'unrecognised column "' + h + '" — the build ignores it'));
    }
  });

  COLUMNS.forEach(function (want) {
    if (sheet.header.indexOf(want) === -1) {
      problems.push(mk(sheet.name, 1, "", 'column "' + want + '" is missing'));
    }
  });
}

function checkRows(sheet, problems) {
  var seen = {};
  var slugs = [];

  sheet.rows.forEach(function (row) {
    var inv = cell(row.values["Inv. Nr."]);
    if (!inv) {
      problems.push(mk(sheet.name, row.line, "", "row has no Inv. Nr."));
      return;
    }

    // An imported spreadsheet header row: values equal their own column names.
    var headerish = 0;
    for (var k in row.values) {
      var v = row.values[k];
      if (v && String(v).trim() === String(k).trim()) headerish++;
    }
    if (headerish >= 3) {
      problems.push(mk(sheet.name, row.line, inv,
        "looks like an imported header row — delete it"));
      return;
    }

    var slug = slugify(inv, { lower: true });
    if (seen[slug]) {
      problems.push(mk(sheet.name, row.line, inv,
        'duplicate URL "' + slug + '", already used by row ' + seen[slug]));
    } else {
      seen[slug] = row.line;
    }
    slugs.push({ slug: slug, line: row.line, inv: inv });
  });

  checkPrefixCollisions(sheet.name, slugs, problems);
}

/**
 * Images are found by filename convention, so a slug that prefixes another would
 * sweep up the other's images. Refuse to guess.
 */
function checkPrefixCollisions(tab, slugs, problems) {
  var sorted = slugs.slice().sort(function (a, b) {
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  for (var i = 1; i < sorted.length; i++) {
    if (sorted[i].slug.indexOf(sorted[i - 1].slug + "-") === 0) {
      problems.push(mk(tab, sorted[i].line, sorted[i].inv,
        '"' + sorted[i - 1].inv + '" is a filename prefix of "' + sorted[i].inv +
        '" — image lookup is ambiguous between them'));
    }
  }
}

function writeReport(ss, problems) {
  var sheet = ss.getSheetByName(REPORT);
  if (sheet) sheet.clear(); else sheet = ss.insertSheet(REPORT);

  var stamp = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(),
                                   "yyyy-MM-dd HH:mm");
  if (!problems.length) {
    sheet.getRange(1, 1).setValue("Keine Probleme gefunden — " + stamp);
    SpreadsheetApp.getActive().toast("Keine Probleme gefunden.", "Prüfung", 5);
    return;
  }

  var rows = [["Tab", "Zeile", "Inv. Nr.", "Problem"]];
  problems.forEach(function (p) {
    rows.push([p.tab, p.line, p.inv, p.message]);
  });

  sheet.getRange(1, 1, rows.length, 4).setValues(rows);
  sheet.getRange(1, 1, 1, 4).setFontWeight("bold");
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 4);
  sheet.getRange(rows.length + 2, 1)
       .setValue(problems.length + " Problem(e) — " + stamp);

  sheet.activate();
  SpreadsheetApp.getActive()
    .toast(problems.length + " Problem(e) — siehe " + REPORT, "Prüfung", 5);
}
