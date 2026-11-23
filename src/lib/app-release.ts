declare const __NEXO_RELEASE__: string;
export const APP_RELEASE=typeof __NEXO_RELEASE__==='string'&&/^[a-f0-9]{40}$/.test(__NEXO_RELEASE__)?__NEXO_RELEASE__:'unavailable';
