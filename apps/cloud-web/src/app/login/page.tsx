'use client';
import {useState,type FormEvent} from 'react';
export default function Login(){
 const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError('');const data=new FormData(event.currentTarget);
  try{const response=await fetch('/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:data.get('email'),password:data.get('password')})});
   if(!response.ok){setError(response.status===429?'Thử lại sau / Try again later':'Không đăng nhập được / Sign in failed');return;}window.location.assign('/admin/settings');
  }catch{setError('Không kết nối được / Connection unavailable');}finally{setBusy(false);}
 }
 return <main><h1>Đăng nhập / Sign in</h1><form onSubmit={submit}><label>Email<input name="email" type="email" required autoComplete="username"/></label><label>Mật khẩu / Password<input name="password" type="password" required autoComplete="current-password"/></label><button disabled={busy}>{busy?'Đang đăng nhập…':'Đăng nhập / Sign in'}</button><p role="alert">{error}</p></form></main>;
}
