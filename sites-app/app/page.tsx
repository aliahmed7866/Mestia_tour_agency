import type {Metadata} from 'next';
export const metadata:Metadata={robots:{index:true,follow:true},alternates:{canonical:'https://svanetiguide.com/'}};
import PublicApp from './components/PublicApp';
export default function Home(){return <PublicApp/>;}
