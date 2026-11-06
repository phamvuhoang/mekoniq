export function BrandLogo({compact=false,href='/',label='MEKONIQ'}:{compact?:boolean;href?:string;label?:string}) {
 return <a className={`mq-brand${compact?' mq-brand--icon':''}`} href={href} aria-label={label}><picture><source media="(max-width: 767px)" srcSet="/brand/assets/MEKONIQ_Icon_Transparent.svg"/><img src={compact?'/brand/assets/MEKONIQ_Icon_Transparent.svg':'/brand/assets/MEKONIQ_Horizontal_White_Transparent_v2.png'} alt=""/></picture></a>;
}
