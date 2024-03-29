import { React, useEffect, useState } from "react";

export function Eigenschaft({ title, value }) {
  return (
    value &&
    value !== "-" && (
      <p className="py-1">
        <span className="font-semibold text-gray-500">{title}: </span>
        {value}
      </p>
    )
  );
}

export function EigenschaftWithLink({ title, value, href }) {
  return (
    value &&
    value !== "-" && (
      <p className="py-1">
        <span className="font-semibold text-gray-500">{title}: </span>

        <a className="text-blue-800" href={href}>
          {" "}
          {value}
        </a>
      </p>
    )
  );
}
