/** Buffer complete lines before redaction: pipe chunks may split a pairing token anywhere. */
export function pairingOutput(write){
 let pending='';
 const emit=line=>write(line.replace(/(pairing (?:code|token)[^:\n]*:\s*)\S+/gi,'$1<redacted>'));
 return {write(chunk){pending+=String(chunk);let index;while((index=pending.indexOf('\n'))>=0){emit(pending.slice(0,index+1));pending=pending.slice(index+1);}},end(){if(pending)emit(pending);pending='';}};
}
export function validatedRuntimePort(value){
 if(value===undefined)return 4176;
 if(!/^\d+$/.test(value))throw new Error('INVALID_RUNTIME_PORT');
 const port=Number(value);if(!Number.isInteger(port)||port<1024||port>65535||[1880,1884].includes(port))throw new Error('INVALID_RUNTIME_PORT');
 return port;
}
