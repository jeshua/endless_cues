// The types of the vendored Preact + htm (preact-htm.js beside this file, with its two changes): Preact's own, from
// the preact package (a development dependency, for its types only: the window runs the vendored file).
export { h, render, Component, createContext } from 'preact';
export { useState, useReducer, useEffect, useLayoutEffect, useRef, useImperativeHandle, useMemo, useCallback, useContext, useDebugValue, useErrorBoundary } from 'preact/hooks';
/** htm bound to `h`: a tagged template that makes Preact elements. */
export declare function html(strings: TemplateStringsArray, ...values: unknown[]): import('preact').VNode<any>;
