// Self-hosted IBM Plex.
//
// The shell used to pull these from fonts.googleapis.com, which meant a PWA
// installed on a music stand fell back to system fonts the moment it was
// offline — and every load leaked a request to a third party. Importing the
// latin subsets only, at the weights the stylesheet actually uses, keeps the
// bundle small; Vite hashes and fingerprints the woff2 files, and the service
// worker caches them like any other build asset.
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';

import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-700.css';
