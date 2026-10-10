import { loadToken } from "./editorAuth.js";

/**
 * "Bearbeiten", shown only while signed into the editor in this tab (the same
 * check as the footer). Display only: Google decides what the token may do.
 */
export default function EditLink({ gruppe, invNr }) {
  if (!loadToken()) return null;
  const href = `/bearbeiten/?${new URLSearchParams({ gruppe, werk: invNr })}`;
  return <a className="print:hidden text-blue-800" href={href}>Bearbeiten</a>;
}
