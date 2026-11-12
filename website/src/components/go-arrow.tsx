// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/** The arrow at the right of a bar: a drawn line with an open head, in the bar's own text color. */
export function GoArrow() {
  return (
    <svg className="home-go" viewBox="0 0 30 14" width="30" height="14" aria-hidden="true" focusable="false">
      <path d="M1 7h27M22 1l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter" />
    </svg>
  );
}
