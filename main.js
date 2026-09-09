(function () {
  "use strict";

  document.documentElement.classList.add("js");

  var nav = document.getElementById("site-nav");
  var frameRequested = false;

  function updateNav() {
    frameRequested = false;
    if (nav) {
      nav.classList.toggle("is-pilled", window.scrollY > 32);
    }
  }

  function requestNavUpdate() {
    if (!frameRequested) {
      frameRequested = true;
      window.requestAnimationFrame(updateNav);
    }
  }

  window.addEventListener("scroll", requestNavUpdate, { passive: true });
  updateNav();

  var dialog = document.getElementById("meme-dialog");
  var tiles = Array.prototype.slice.call(document.querySelectorAll(".meme-tile"));

  if (!dialog || !tiles.length || typeof dialog.showModal !== "function") {
    return;
  }

  var display = document.getElementById("meme-display");
  var status = document.getElementById("meme-dialog-status");
  var closeButton = dialog.querySelector("[data-dialog-close]");
  var previousButton = dialog.querySelector("[data-meme-prev]");
  var nextButton = dialog.querySelector("[data-meme-next]");
  var activeIndex = 0;
  var returnFocus = null;

  function renderMeme(index) {
    activeIndex = (index + tiles.length) % tiles.length;
    var tile = tiles[activeIndex];
    var uploadedImage = tile.querySelector(".meme-uploaded-image");
    if (!uploadedImage) return;
    var artwork = uploadedImage.cloneNode(true);
    artwork.classList.remove("image-fit-cover");
    artwork.classList.add("image-fit-contain", "meme-dialog-image");
    artwork.removeAttribute("aria-hidden");
    artwork.alt = tile.dataset.memeImageAlt || "";

    display.replaceChildren(artwork);
    status.textContent = "Meme " + (activeIndex + 1) + " of " + tiles.length;
  }

  function openMeme(index, trigger) {
    returnFocus = trigger;
    renderMeme(index);
    dialog.showModal();
    closeButton.focus();
  }

  function closeMeme() {
    if (dialog.open) {
      dialog.close();
    }
  }

  tiles.forEach(function (tile, index) {
    tile.addEventListener("click", function () {
      openMeme(index, tile);
    });
  });

  previousButton.addEventListener("click", function () {
    renderMeme(activeIndex - 1);
  });

  nextButton.addEventListener("click", function () {
    renderMeme(activeIndex + 1);
  });

  closeButton.addEventListener("click", closeMeme);

  dialog.addEventListener("click", function (event) {
    if (event.target === dialog) {
      closeMeme();
    }
  });

  dialog.addEventListener("cancel", function (event) {
    event.preventDefault();
    closeMeme();
  });

  dialog.addEventListener("keydown", function (event) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      renderMeme(activeIndex - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      renderMeme(activeIndex + 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeMeme();
    }
  });

  dialog.addEventListener("close", function () {
    if (returnFocus && document.contains(returnFocus)) {
      returnFocus.focus();
    }
  });
})();
