import { isEditorBrowser } from "./editorAuth.js";

/** "Bearbeiten", shown only in a browser that has used the editor. Not access control. */
export default function EditLink({ gruppe, invNr }) {
  if (!isEditorBrowser()) return null;
  const href = `/bearbeiten/?${new URLSearchParams({ gruppe, werk: invNr })}`;
  return <a className="print:hidden text-blue-800" href={href}>Bearbeiten</a>;
}
