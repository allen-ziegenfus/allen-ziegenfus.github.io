import { useState } from "react";
import { Lightbox } from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";

/**
 * Die Bilder eines Werks (build_data.ts → Bild): das erste groß, die anderen als
 * Vorschaubilder, die eine Lightbox öffnen. Videos werden stattdessen abgespielt,
 * ein <source> je Datei.
 */
function Bildelement({ bild, alt, sizes, klasse, sofort }) {
  const stil = bild.vorschau
    ? { background: `url(${bild.vorschau}) center / cover no-repeat` } : undefined;
  const img = (
    <img src={bild.src} alt={alt} width={bild.breite} height={bild.hoehe} className={klasse}
         style={stil} loading={sofort ? "eager" : "lazy"} decoding="async" />
  );
  if (!bild.webp) return img;
  return (
    <picture>
      {bild.avif && <source type="image/avif" srcSet={bild.avif} sizes={sizes} />}
      <source type="image/webp" srcSet={bild.webp} sizes={sizes} />
      {img}
    </picture>
  );
}

export default function Bildbetrachter({ bilder, titel }) {
  const [offen, setOffen] = useState(false);
  const [index, setIndex] = useState(0);

  if (bilder[0]?.video) {
    return (
      <video className="w-full" controls aria-label={titel}>
        {bilder.filter(v => v.video).map(v => <source key={v.src} src={v.src} type={v.video} />)}
      </video>
    );
  }

  return (
    <div className="flex flex-row flex-wrap justify-center">
      {/* Ab lg die halbe Seite, darunter die volle Breite. */}
      <Bildelement bild={bilder[0]} alt={titel} klasse="w-full" sofort
                   sizes="(min-width: 1024px) 50vw, 100vw" />
      <div className="flex flex-wrap mx-auto align-center justify-center">
        {bilder.length > 1 && bilder.map((bild, i) => (
          <button key={bild.src} className="cursor-pointer w-28 m-1"
                  onClick={() => { setIndex(i); setOffen(true); }}>
            <Bildelement bild={bild} alt={`${titel} (${i + 1})`} sizes="112px" />
          </button>
        ))}
      </div>
      <Lightbox
        open={offen}
        close={() => setOffen(false)}
        index={index}
        slides={bilder.map(b => ({ src: b.gross ?? b.src, width: b.breite, height: b.hoehe }))}
      />
    </div>
  );
}
