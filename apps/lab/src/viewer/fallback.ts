import { MAX_TRAYS } from '../project/schema';
/** Original lightweight illustration; importing this module never loads Three.js. */
export function robotSvg(
  trays: number,
  selected: string,
  exploded = 0,
): string {
  trays=Number.isFinite(trays)?Math.min(MAX_TRAYS,Math.max(0,Math.floor(trays))):0;
  return `<svg class="robot-fallback" viewBox="0 ${-exploded * 120} 500 ${460 + exploded * 120}" role="img" aria-label="Service robot 2D illustration"><defs><linearGradient id="metal"><stop stop-color="#657e85"/><stop offset=".45" stop-color="#e1e8df"/><stop offset="1" stop-color="#8aa2a2"/></linearGradient></defs><ellipse cx="250" cy="400" rx="140" ry="25" fill="#0003"/><path d="M130 390h240M100 410h300" stroke="#2c424b"/><g stroke="#82999c" stroke-width="10"><path d="M183 330V110m134 220V110"/></g><ellipse cx="250" cy="353" rx="108" ry="35" fill="url(#metal)"/><path d="M142 345v25c0 45 216 45 216 0v-25" fill="#b1c3be"/><ellipse cx="250" cy="345" rx="108" ry="35" fill="#22363d"/><path d="M150 371q100 45 200 0" fill="none" stroke="#b4f375" stroke-width="7"/>${Array.from({ length: trays }, (_, i) => `<g transform="translate(0 ${-i * 64 - (i + 2) * exploded * 15})"><path d="m151 287 98-36 100 36-100 37Z" fill="${selected === "trays" ? "#b4f375" : "#d3dcd3"}" stroke="#1c3137" stroke-width="7"/><path d="m151 287 98 37 100-37v10l-100 37-98-37Z" fill="#29434a"/></g>`).join("")}<path d="M250 ${265 - (trays - 1) * 64 - (trays + 2) * exploded * 15}v-40" stroke="#bdcfc8" stroke-width="9"/><path d="m215 ${205 - (trays - 1) * 64 - (trays + 2) * exploded * 15} 64 7v43l-64-7Z" fill="#233a40" stroke="#849f9e" stroke-width="4"/><path d="m223 ${213 - (trays - 1) * 64 - (trays + 2) * exploded * 15} 47 5v26l-47-5Z" fill="#b4f375"/><ellipse cx="250" cy="333" rx="25" ry="8" fill="#b4f375"/></svg>`;
}
