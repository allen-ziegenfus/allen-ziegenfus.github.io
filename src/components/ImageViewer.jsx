import { useState } from "react";
import { Lightbox } from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";

/**
 * A work's images (build_data.ts → Bild): the first large, the others as
 * thumbnails that open a lightbox. Videos play instead, one <source> per file.
 */
function Picture({ bild, alt, sizes, className, eager }) {
  const style = bild.vorschau
    ? { background: `url(${bild.vorschau}) center / cover no-repeat` } : undefined;
  const img = (
    <img src={bild.src} alt={alt} width={bild.breite} height={bild.hoehe} className={className}
         style={style} loading={eager ? "eager" : "lazy"} decoding="async" />
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

export default function ImageViewer({ imgs, title }) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  if (imgs[0]?.video) {
    return (
      <video className="w-full" controls aria-label={title}>
        {imgs.filter(v => v.video).map(v => <source key={v.src} src={v.src} type={v.video} />)}
      </video>
    );
  }

  return (
    <div className="flex flex-row flex-wrap justify-center">
      {/* Half the page from lg up, full width below. */}
      <Picture bild={imgs[0]} alt={title} className="w-full" eager
               sizes="(min-width: 1024px) 50vw, 100vw" />
      <div className="flex flex-wrap mx-auto align-center justify-center">
        {imgs.length > 1 && imgs.map((bild, i) => (
          <button key={bild.src} className="cursor-pointer w-28 m-1"
                  onClick={() => { setIndex(i); setOpen(true); }}>
            <Picture bild={bild} alt={`${title} (${i + 1})`} sizes="112px" />
          </button>
        ))}
      </div>
      <Lightbox
        open={open}
        close={() => setOpen(false)}
        index={index}
        slides={imgs.map(b => ({ src: b.gross ?? b.src, width: b.breite, height: b.hoehe }))}
      />
    </div>
  );
}
