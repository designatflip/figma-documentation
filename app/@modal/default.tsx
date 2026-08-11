/**
 * Nothing is overlaid on a normal page load. Without this file, every route
 * that is not an intercepted screen would 404 on the unmatched slot.
 */
export default function ModalDefault() {
  return null;
}
