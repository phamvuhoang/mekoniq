// R4-D44: bounded nonlinear least squares for the few parameters a bench can tell apart. Levenberg-Marquardt-damped Gauss-Newton with a forward-difference Jacobian; every step is projected onto the bounds and a
// parameter that sits on a bound with the gradient pushing outward is frozen. Pure and deterministic: no randomness, evaluations in a fixed order, so the same residual function and plan give the same bits.
// Parameters are handled in units of their own range (upper - lower), so the conditioning it reports does not depend on the unit a parameter happens to be written in.
export interface LeastSquaresProblem {initial:number[];lower:number[];upper:number[];maxIterations:number;tolerance:number;relativeStep:number}
export interface LeastSquaresResult {x:number[];atBound:boolean[];standardError:(number|null)[];jacobianCondition:number;iterations:number;converged:boolean;objectiveInitial:number;objectiveFinal:number}
export const LEAST_SQUARES_MAX_PARAMETERS=12;
/** Above this the Jacobian cannot separate the parameters (columns of the scaled Jacobian are almost parallel): the standard errors are `null`, whatever the plan allows. */
const SINGULAR_CONDITION=1e8;
const BOUND_EPS=1e-9;
/** The condition number read at a step and at a quarter of it must agree within this factor, else it is a finite-difference artefact. */
const STEP_STABLE_RATIO=2;

const sumSquares=(r:readonly number[])=>r.reduce((s,v)=>s+v*v,0);
/** Singular values and right vectors of an m x n matrix by one-sided Jacobi (Hestenes): exact to relative machine precision, so two identical columns give a singular value ~1e-16 of the largest, not a rounding guess. */
function svd(a:number[][],n:number):{sigma:number[];v:number[][]}{
 const m=a.length,u=a.map(r=>[...r]),v=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>+(i===j)));
 for(let sweep=0;sweep<60;sweep++){
  let rotated=false;
  for(let p=0;p<n-1;p++)for(let q=p+1;q<n;q++){
   let alpha=0,beta=0,gamma=0;
   for(let i=0;i<m;i++){alpha+=u[i]![p]!**2;beta+=u[i]![q]!**2;gamma+=u[i]![p]!*u[i]![q]!;}
   if(gamma===0||Math.abs(gamma)<=1e-15*Math.sqrt(alpha*beta))continue;
   rotated=true;
   const zeta=(beta-alpha)/(2*gamma),t=Math.sign(zeta||1)/(Math.abs(zeta)+Math.sqrt(1+zeta*zeta)),c=1/Math.sqrt(1+t*t),s=c*t;
   for(let i=0;i<m;i++){const x=u[i]![p]!,y=u[i]![q]!;u[i]![p]=c*x-s*y;u[i]![q]=s*x+c*y;}
   for(let i=0;i<n;i++){const x=v[i]![p]!,y=v[i]![q]!;v[i]![p]=c*x-s*y;v[i]![q]=s*x+c*y;}
  }
  if(!rotated)break;
 }
 return {sigma:Array.from({length:n},(_,j)=>Math.sqrt(u.reduce((s,r)=>s+r[j]!**2,0))),v};
}
/** Gaussian elimination with partial pivoting; null when the matrix is singular (the caller damps harder). */
function solve(a:number[][],b:number[]):number[]|null{
 const n=b.length,m=a.map((r,i)=>[...r,b[i]!]);
 for(let c=0;c<n;c++){
  let p=c;for(let r=c+1;r<n;r++)if(Math.abs(m[r]![c]!)>Math.abs(m[p]![c]!))p=r;
  if(Math.abs(m[p]![c]!)<1e-300)return null;
  [m[c],m[p]]=[m[p]!,m[c]!];
  for(let r=c+1;r<n;r++){const f=m[r]![c]!/m[c]![c]!;for(let k=c;k<=n;k++)m[r]![k]!-=f*m[c]![k]!;}
 }
 const x=Array<number>(n).fill(0);
 for(let r=n-1;r>=0;r--){let s=m[r]![n]!;for(let k=r+1;k<n;k++)s-=m[r]![k]!*x[k]!;x[r]=s/m[r]![r]!;}
 return x.every(Number.isFinite)?x:null;
}

export async function fitBoundedLeastSquares(residual:(x:readonly number[])=>Promise<number[]>,problem:LeastSquaresProblem):Promise<LeastSquaresResult>{
 const {initial,lower,upper,maxIterations,tolerance,relativeStep}=problem,n=initial.length;
 const finite=(a:readonly number[])=>a.length===n&&a.every(Number.isFinite);
 if(n<1||n>LEAST_SQUARES_MAX_PARAMETERS||!finite(initial)||!finite(lower)||!finite(upper)||lower.some((l,j)=>!(l<upper[j]!))||initial.some((v,j)=>v<lower[j]!||v>upper[j]!)
  ||!Number.isSafeInteger(maxIterations)||maxIterations<1||!(tolerance>0&&Number.isFinite(tolerance))||!(relativeStep>0&&Number.isFinite(relativeStep)))throw Error('PROBLEM_INVALID');
 const range=lower.map((l,j)=>upper[j]!-l);
 let m=-1;
 const evaluate=async(x:readonly number[])=>{
  const r=await residual(x);
  if(!Array.isArray(r)||!r.length||r.some(v=>typeof v!=='number'||!Number.isFinite(v))||m>=0&&r.length!==m)throw Error('RESIDUAL_INVALID');
  m=r.length;return r;
 };
 const clip=(x:number[])=>x.map((v,j)=>Math.min(upper[j]!,Math.max(lower[j]!,v)));
 /** One finite-difference step of parameter j: relative to its value, in the direction with room, never longer than the room the bounds leave (a valid interval narrower than the step is fitted inside it). */
 const stepOf=(x:number[],j:number,rel:number)=>{
  const h=rel*(Math.abs(x[j]!)>0?Math.abs(x[j]!):range[j]!),up=upper[j]!-x[j]!,down=x[j]!-lower[j]!,sign=up>=h||up>=down&&down<h?1:-1,room=sign>0?up:down,mag=Math.min(h,room);
  // a step that does not move the parameter in floating point is a problem the finite differences cannot pose
  if(!(mag>0)||x[j]!+sign*mag===x[j])throw Error('PROBLEM_INVALID');
  return sign*mag;
 };
 /** forward (or, at the upper end, backward) differences with relative step `rel`, in units of the parameters' ranges (J_s = J D) */
 const jacobian=async(x:number[],r:number[],rel=relativeStep)=>{
  const cols:number[][]=[];
  for(let j=0;j<n;j++){
   const h=stepOf(x,j,rel),xs=[...x];xs[j]=Math.min(upper[j]!,Math.max(lower[j]!,x[j]!+h));
   const rj=await evaluate(xs);
   cols.push(rj.map((v,i)=>(v-r[i]!)/(xs[j]!-x[j]!)*range[j]!));
  }
  return Array.from({length:r.length},(_,i)=>cols.map(c=>c[i]!));
 };
 let x=[...initial],r=await evaluate(x),f=sumSquares(r);
 const objectiveInitial=f;let lambda=1e-3,iterations=0,converged=false;
 while(iterations<maxIterations){
  const J=await jacobian(x,r),g=Array.from({length:n},(_,j)=>J.reduce((s,row,i)=>s+row[j]!*r[i]!,0));
  // a parameter on a bound whose descent direction (-g) points out of it is frozen
  const free:number[]=[];for(let j=0;j<n;j++){const atLo=x[j]!<=lower[j]!+BOUND_EPS*range[j]!,atHi=x[j]!>=upper[j]!-BOUND_EPS*range[j]!;if(!(atLo&&g[j]!>0)&&!(atHi&&g[j]!<0))free.push(j);}
  iterations++;
  if(!free.length||f<=Number.EPSILON*objectiveInitial){converged=true;break;}
  const H=free.map(a=>free.map(b=>J.reduce((s,row)=>s+row[a]!*row[b]!,0)));
  let accepted=false;
  for(let attempt=0;attempt<10&&!accepted;attempt++){
   const damped=H.map((row,a)=>row.map((v,b)=>(a===b?v+lambda*Math.max(v,1e-30):v))),d=solve(damped,free.map(j=>-g[j]!));
   if(!d){lambda=Math.min(lambda*10,1e12);continue;}
   const xn=[...x];free.forEach((j,k)=>{xn[j]=x[j]!+d[k]!*range[j]!;});
   const xc=clip(xn),rn=await evaluate(xc),fn=sumSquares(rn);
   if(fn<f){
    const small=free.every(j=>Math.abs(xc[j]!-x[j]!)<=tolerance*range[j]!),flat=f-fn<=tolerance*f;
    x=xc;r=rn;const before=f;f=fn;lambda=Math.max(lambda/3,1e-12);accepted=true;
    if(small||flat||f<=Number.EPSILON*objectiveInitial||before-f<=0)converged=true;
   }else lambda=Math.min(lambda*4,1e12);
  }
  // no damped step lowers the objective: that is a minimum only if the gradient is (relatively) zero. A steep slope with no improving step is a residual the finite differences cannot follow (a jagged, chattering
  // response): it is reported as not converged, never as a minimum.
  if(!accepted){
   const gn=Math.sqrt(free.reduce((s,j)=>s+g[j]!*g[j]!,0)),jn=Math.sqrt(J.reduce((s,row)=>s+row.reduce((a,v)=>a+v*v,0),0));
   converged=gn===0||gn<=Math.sqrt(tolerance)*jn*Math.sqrt(f);break;
  }
  if(converged)break;
 }
 // The conditioning that decides identifiability is read at two finite-difference steps. Two parameters that only ever act through their sum have exactly parallel true derivatives, but forward differences with
 // different steps leave truncation errors that look like a second direction (a condition of 10^3-10^4 at a step of 1 %, shrinking as the step does): a condition that moves with the step is that artefact, not
 // information, and counts as unbounded. A separable problem's condition is the same at both steps.
 const svdOf=(J:number[][])=>m>=n?svd(J,n):{sigma:Array<number>(n).fill(0),v:[] as number[][]};
 const condOf=(sigma:number[])=>{const hi=Math.max(...sigma),lo=Math.min(...sigma);return m<n||!(lo>0)||!(hi>0)?Infinity:hi/lo;};
 const J=await jacobian(x,r),{sigma,v}=svdOf(J);let jacobianCondition=condOf(sigma);
 if(n>1&&Number.isFinite(jacobianCondition)){
  const c2=condOf(svdOf(await jacobian(x,r,relativeStep/4)).sigma),hi=Math.max(jacobianCondition,c2),lo=Math.min(jacobianCondition,c2);
  jacobianCondition=Number.isFinite(c2)&&hi/lo<=STEP_STABLE_RATIO?hi:Infinity;
 }
 let standardError:(number|null)[]=Array<number|null>(n).fill(null);
 if(m>n&&jacobianCondition<=SINGULAR_CONDITION){
  const s2=f/(m-n);
  standardError=Array.from({length:n},(_,j)=>{const cov=v[j]!.reduce((s,vjk,k)=>s+vjk*vjk/(sigma[k]!*sigma[k]!),0),e=range[j]!*Math.sqrt(s2*cov);return Number.isFinite(e)?e:null;});
 }
 return {x,atBound:x.map((val,j)=>val<=lower[j]!+BOUND_EPS*range[j]!||val>=upper[j]!-BOUND_EPS*range[j]!),standardError,jacobianCondition,iterations,converged,objectiveInitial,objectiveFinal:f};
}
