'use strict';
/* Runs inside the WorkTrail website window before the page draws.
   It only adds a style sheet that hides the website's own menu, banner, footer, WordPress
   bar and page title, so staff see WorkTrail alone, like a real program. It gives the
   website no access to the computer. The website in an ordinary browser is not touched. */

const CSS = `
html:has(#worktrail-root, .wt-signin) { margin-top: 0 !important; background: #f5f6fa !important; }
html:has(#worktrail-root, .wt-signin) body { margin: 0 !important; padding: 0 !important; background: #f5f6fa !important; }

/* Hide everything that is not WorkTrail, and not a box that holds WorkTrail. */
html:has(#worktrail-root, .wt-signin) body :not(:has(#worktrail-root, .wt-signin)):not(#worktrail-root):not(#worktrail-root *):not(.wt-signin):not(.wt-signin *) { display: none !important; }

/* Boxes that hold WorkTrail: no margins, no narrow columns, no frames. */
html:has(#worktrail-root, .wt-signin) body :has(#worktrail-root, .wt-signin) {
	margin: 0 !important; padding: 0 !important; max-width: none !important; width: 100% !important;
	min-width: 0 !important; min-height: 0 !important; border: 0 !important; border-radius: 0 !important;
	box-shadow: none !important; background: transparent !important; float: none !important;
	transform: none !important; filter: none !important;
}

/* WorkTrail itself fills the window. */
html:has(#worktrail-root, .wt-signin) #worktrail-root,
html:has(#worktrail-root, .wt-signin) .wt-signin {
	margin: 0 !important; border: 0 !important; border-radius: 0 !important; max-width: none !important;
	width: 100% !important; min-height: 100vh !important;
}
html:has(#worktrail-root, .wt-signin) .wt-top { border-radius: 0 !important; }
`;

function addStyle() {
	if (document.getElementById('wt-desktop-css')) return true;
	const parent = document.head || document.documentElement;
	if (!parent) return false;
	const style = document.createElement('style');
	style.id = 'wt-desktop-css';
	style.textContent = CSS;
	parent.appendChild(style);
	return true;
}

if (!addStyle()) {
	document.addEventListener('readystatechange', addStyle);
	document.addEventListener('DOMContentLoaded', addStyle);
}
