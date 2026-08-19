export const FITS = ["cover", "contain"];

export const FOCUSES = [
  "center",
  "top",
  "bottom",
  "left",
  "right",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right"
];

export function fitClass(fit) {
  return FITS.includes(fit) ? `image-fit-${fit}` : "image-fit-cover";
}

export function focusClass(focus) {
  return FOCUSES.includes(focus) ? `image-focus-${focus}` : "image-focus-center";
}
