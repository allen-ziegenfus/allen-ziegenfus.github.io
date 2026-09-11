/**
 * "Neues Werk" — add a work and its images without touching filenames by hand.
 *
 * The image naming convention (`<slug>-NN.<ext>`, where <slug> is the site's slugify
 * of the Inv. Nr.) is the one thing an editor cannot see and cannot easily get right.
 * This derives it, so adding a work is filling in a form rather than remembering a rule.
 *
 * Runs as the editor, so the editor needs Editor access to the Drive folder. The
 * build's service account keeps Viewer — it only ever reads.
 *
 * Configure once: Werkverzeichnis -> Bilder-Ordner festlegen (stores DRIVE_FOLDER_ID
 * in Script Properties).
 */

var PROP_FOLDER = "DRIVE_FOLDER_ID";
var ALLOWED_EXT = ["webp", "jpg", "jpeg", "png", "gif", "tif", "tiff", "webm", "mp4"];

function showAddWorkForm() {
  if (!getFolderId()) {
    SpreadsheetApp.getUi().alert(
      "Bitte zuerst den Bilder-Ordner festlegen (Menü Werkverzeichnis).");
    return;
  }
  var html = HtmlService.createHtmlOutputFromFile("Form").setTitle("Neues Werk");
  SpreadsheetApp.getUi().showSidebar(html);
}

function setDriveFolder() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt("Bilder-Ordner",
    "Drive-Ordner-ID (aus der Ordner-URL):", ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var id = res.getResponseText().trim();
  try {
    DriveApp.getFolderById(id);
  } catch (e) {
    ui.alert("Kein Zugriff auf diesen Ordner: " + e.message);
    return;
  }
  PropertiesService.getDocumentProperties().setProperty(PROP_FOLDER, id);
  ui.alert("Gespeichert.");
}

function getFolderId() {
  return PropertiesService.getDocumentProperties().getProperty(PROP_FOLDER);
}

/** Werkgruppen and their columns, for the form to render itself. */
function getFormConfig() {
  var ss = SpreadsheetApp.getActive();
  var overview = readTab(ss, "_Übersicht");
  var groups = [];
  if (overview) {
    overview.rows.forEach(function (r) {
      var tab = cell(r.values["Tab"]);
      if (tab) groups.push({ tab: tab, titel: cell(r.values["Titel"]) || tab });
    });
  }
  return { werkgruppen: groups, columns: COLUMNS };
}

/**
 * Append one work and upload its images.
 *
 * payload = { tab, values: {column: string}, files: [{name, dataB64}] }
 *
 * Validates before writing anything: a rejected work leaves the Sheet and Drive
 * untouched, because a half-added work is what breaks the build under STRICT=1.
 */
function addWork(payload) {
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActive();
    var tab = payload.tab;
    var sheet = ss.getSheetByName(tab);
    if (!sheet) throw new Error('Tab "' + tab + '" nicht gefunden.');

    var inv = (payload.values["Inv. Nr."] || "").trim();
    if (!inv) throw new Error("Inv. Nr. fehlt.");

    var data = readTab(ss, tab);
    var check = validateNewInvNr(inv, data);
    if (check) throw new Error(check);

    var slug = slugify(inv, { lower: true });
    var files = payload.files || [];
    files.forEach(function (f) {
      var ext = extensionOf(f.name);
      if (!ext) throw new Error('Dateityp nicht unterstützt: "' + f.name + '"');
    });

    // Upload first. A failed upload must not leave an orphan row behind; a failed
    // row append can at worst leave images that the next check reports as orphans.
    var folder = subfolder(tab);
    var uploaded = [];
    files.forEach(function (f, i) {
      var name = slug + "-" + pad(i + 1) + "." + extensionOf(f.name);
      var blob = Utilities.newBlob(
        Utilities.base64Decode(f.dataB64), null, name);
      uploaded.push(folder.createFile(blob).getName());
    });

    var row = data.header.map(function (h) {
      return payload.values[h] !== undefined ? payload.values[h] : "";
    });
    sheet.appendRow(row);

    return {
      inv: inv,
      slug: slug,
      images: uploaded,
      url: "/" + slugOfTab(ss, tab) + "/" + slug + "/"
    };
  } finally {
    lock.releaseLock();
  }
}

/** The same two uniqueness rules the build enforces, applied before the row exists. */
function validateNewInvNr(inv, data) {
  var slug = slugify(inv, { lower: true });
  var slugs = [];
  for (var i = 0; i < data.rows.length; i++) {
    var existing = cell(data.rows[i].values["Inv. Nr."]);
    if (!existing) continue;
    var s = slugify(existing, { lower: true });
    if (s === slug) {
      return 'Inv. Nr. "' + inv + '" ergibt die URL "' + slug +
             '", die Zeile ' + data.rows[i].line + " schon benutzt.";
    }
    slugs.push(s);
  }
  for (var j = 0; j < slugs.length; j++) {
    if (slug.indexOf(slugs[j] + "-") === 0) {
      return '"' + slugs[j] + '" ist ein Dateiname-Präfix von "' + slug +
             '" — die Bildzuordnung wäre mehrdeutig.';
    }
    if (slugs[j].indexOf(slug + "-") === 0) {
      return '"' + slug + '" ist ein Dateiname-Präfix von "' + slugs[j] +
             '" — die Bildzuordnung wäre mehrdeutig.';
    }
  }
  return null;
}

function subfolder(tab) {
  var root = DriveApp.getFolderById(getFolderId());
  var it = root.getFoldersByName(tab);
  if (it.hasNext()) return it.next();
  throw new Error('Drive-Unterordner "' + tab + '" fehlt.');
}

function slugOfTab(ss, tab) {
  var overview = readTab(ss, "_Übersicht");
  var found = tab;
  if (overview) {
    overview.rows.forEach(function (r) {
      if (cell(r.values["Tab"]) === tab) found = cell(r.values["Slug"]) || tab;
    });
  }
  return found;
}

function extensionOf(filename) {
  var m = String(filename).toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!m) return null;
  return ALLOWED_EXT.indexOf(m[1]) === -1 ? null : m[1];
}

function pad(n) {
  return n < 10 ? "0" + n : String(n);
}
