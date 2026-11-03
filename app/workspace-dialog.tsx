'use client';
import {useRef} from 'react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
export default function WorkspaceDialog({title,description,wide=false,busy=false,onClose,children}:{title:string;description:string;wide?:boolean;busy?:boolean;onClose:()=>void;children:React.ReactNode}){
 const previousFocus=useRef<HTMLElement|null>(null);
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent showCloseButton={false} className={'modal workspace-dialog'+(wide?' wide':'')} onOpenAutoFocus={()=>{previousFocus.current=document.activeElement as HTMLElement;}} onCloseAutoFocus={event=>{if(previousFocus.current?.isConnected){event.preventDefault();previousFocus.current.focus();}}} onEscapeKeyDown={event=>{if(busy)event.preventDefault();}} onPointerDownOutside={event=>{if(busy)event.preventDefault();}}><DialogTitle className="sr-only">{title}</DialogTitle><DialogDescription className="workspace-dialog-scope">{description}</DialogDescription><fieldset className="workspace-dialog-fields" disabled={busy}>{children}</fieldset></DialogContent></Dialog>;
}
