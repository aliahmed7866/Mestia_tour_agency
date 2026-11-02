import type {Metadata} from 'next';
// Private routes remain noindex by default. The public homepage opts into indexing.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
const origin = siteUrl && /^https:\/\/[^/]+$/.test(siteUrl) ? siteUrl : undefined;
export const metadata:Metadata={
  metadataBase: origin ? new URL(origin) : undefined,
  title:{default:'Svaneti Guide | Tours in Mestia, Ushguli & Koruldi Lakes',template:'%s | Svaneti Guide'},
  description:'Plan guided tours in Svaneti, Georgia: explore Mestia, Ushguli, Koruldi Lakes and mountain villages. Request local tours, guesthouse stays and private transfers.',
  applicationName:'Svaneti Guide',
  keywords:['Svaneti tours','Mestia tours','Ushguli tours','Koruldi Lakes tour','Svaneti travel guide','Mestia guesthouse','Mestia transfers','Georgia mountain tours'],
  referrer:'no-referrer',
  robots:{index:false,follow:false},
  ...(origin ? {alternates:{canonical:'/'},openGraph:{type:'website' as const,url:origin,siteName:'Svaneti Guide',title:'Svaneti Guide | Explore Mestia, Ushguli & Koruldi',description:'Local Svaneti tours, mountain adventures, guesthouse requests and transfers.'},twitter:{card:'summary_large_image' as const,title:'Svaneti Guide | Tours and Travel in Svaneti'}} : {}),
  icons:{icon:'/favicon.svg'}
};
