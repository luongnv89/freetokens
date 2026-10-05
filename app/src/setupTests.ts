import "@testing-library/jest-dom";

// jsdom implements no layout, so Element.scrollIntoView is absent; components
// that reveal a focused element (the chip rail) call it unconditionally.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
