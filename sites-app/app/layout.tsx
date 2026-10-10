import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'Mestia Travel | Mountains & a place to return to',description:'Private pilot for Mestia tours, welcoming guesthouse stays and local taxi requests.',referrer:'no-referrer',robots:{index:false,follow:false},icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
