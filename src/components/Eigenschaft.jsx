export function Eigenschaft({ titel, wert }) {
  return (
    wert &&
    wert !== "-" && (
      <p className="py-1">
        <span className="font-semibold text-gray-500">{titel}: </span>
        {wert}
      </p>
    )
  );
}

export function EigenschaftMitLink({ titel, wert, href }) {
  return (
    wert &&
    wert !== "-" && (
      <p className="py-1">
        <span className="font-semibold text-gray-500">{titel}: </span>

        <a className="text-blue-800" href={href}>
          {" "}
          {wert}
        </a>
      </p>
    )
  );
}
