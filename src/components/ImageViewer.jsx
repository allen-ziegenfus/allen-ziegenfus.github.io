import { React, useState } from "react";
import { Lightbox } from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";

export default function ImageViewer({ imgs, title }) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  const mainSrc = imgs[0]?.src;
  const isVideo = imgs[0]?.src.endsWith(".webm");
  return (
    <div className="flex flex-row flex-wrap justify-center">
      {isVideo && <video src={mainSrc} controls alt={title} />}
      {!isVideo && <img className="w-full" src={mainSrc} alt={title}/>}
      <div className="flex flex-wrap mx-auto align-center justify-center">
        {imgs.length > 1 &&
          imgs.map((img, index) => (
            <img
              className="cursor-pointer w-28 m-1"
              onClick={() => {
                setIndex(index);
                setOpen(true);
              }}
              src={img.src}
              alt={title}
            />
          ))}
      </div>
      <Lightbox 
        open={open}
        close={() => setOpen(false)}
        index={index}
        slides={imgs}
        />
    </div>
  );
}
