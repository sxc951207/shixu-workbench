import {companyRequest} from './company-root';

export const supervisedRequest=(body:Record<string,unknown>)=>companyRequest({...body,scope:'supervised'});
