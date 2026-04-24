import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Calendar as CalendarIcon, 
  Phone, 
  CheckCircle2, 
  Clock, 
  MapPin, 
  ChevronRight, 
  Users, 
  Stethoscope,
  HeartPulse,
  Activity,
  Baby,
  UserRound,
  ChevronLeft,
  CalendarCheck,
  LogOut,
  User as UserIcon,
  Trash2
} from 'lucide-react';
import { cn } from './lib/utils';
import confetti from 'canvas-confetti';
import { auth, db, signInWithGoogle, logout } from './lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  serverTimestamp, 
  deleteDoc, 
  doc,
  query,
  where,
  writeBatch
} from 'firebase/firestore';

interface Appointment {
  id: string;
  patientId: string;
  patientName: string;
  patientPhone: string;
  specialty: string;
  date: string;
  time: string;
  insurancePlan: string;
  status: string;
  createdAt: any;
}

interface Slot {
  id: string;
  appointmentId: string;
  date: string;
  time: string;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  
  const [formData, setFormData] = useState({
    nome: '',
    telefone: '',
    especialidade: '',
    data: '',
    plano: '',
    hora: '09:00'
  });
  
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<{ message: string; type: 'success' | 'error' | null }>({
    message: '',
    type: null
  });

  const [selectedDate, setSelectedDate] = useState(new Date());

  // Listen for Auth changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
      if (u) {
        setFormData(prev => ({ ...prev, nome: u.displayName || '' }));
      }
    });
    return () => unsubscribe();
  }, []);

  // Listen for user's PRIVATE appointments (secure)
  useEffect(() => {
    if (!user) {
      setAppointments([]);
      return;
    }
    const q = query(collection(db, 'appointments'), where('patientId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const apps: Appointment[] = [];
      snapshot.forEach((doc) => {
        apps.push({ id: doc.id, ...doc.data() } as Appointment);
      });
      setAppointments(apps);
    }, (err) => {
      console.error("Firestore Private Sync Error:", err);
    });
    return () => unsubscribe();
  }, [user]);

  // Listen for PUBLIC availability slots (anonymous)
  useEffect(() => {
    const q = collection(db, 'slots');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const s: Slot[] = [];
      snapshot.forEach((doc) => {
        s.push({ id: doc.id, ...doc.data() } as Slot);
      });
      setSlots(s);
    }, (err) => {
      console.error("Firestore Public Sync Error:", err);
    });
    return () => unsubscribe();
  }, []);

  const specialties = [
    { name: 'Clínica Geral', icon: <UserRound className="w-5 h-5" /> },
    { name: 'Pediatria', icon: <Baby className="w-5 h-5" /> },
    { name: 'Cardiologia', icon: <HeartPulse className="w-5 h-5" /> },
    { name: 'Dermatologia', icon: <Activity className="w-5 h-5" /> },
    { name: 'Ginecologia', icon: <Users className="w-5 h-5" /> },
    { name: 'Ortopedia', icon: <Stethoscope className="w-5 h-5" /> }
  ];

  const timeSlots = [
    '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
    '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00'
  ];

  const validateField = (name: string, value: string) => {
    let error = '';
    
    switch (name) {
      case 'nome':
        if (value.trim().length < 3) error = 'O nome deve ter pelo menos 3 caracteres.';
        break;
      case 'telefone':
        const phoneRegex = /^\(?\d{2}\)?\s?\d{4,5}-?\d{4}$/;
        if (!phoneRegex.test(value)) error = 'Formato inválido. Use (11) 99999-9999.';
        break;
      case 'especialidade':
        if (!value) error = 'Selecione uma especialidade.';
        break;
      case 'plano':
        if (!value) error = 'Selecione um plano ou Particular.';
        break;
      case 'data':
        const todayStr = new Date().toISOString().split('T')[0];
        if (!value) error = 'Selecione uma data.';
        else if (value < todayStr) error = 'A data não pode ser no passado.';
        break;
      case 'hora':
        const isSlotTaken = slots.some(slot => slot.date === formData.data && slot.time === value);
        if (isSlotTaken) error = 'Este horário já está reservado.';
        break;
    }
    
    setErrors(prev => ({ ...prev, [name]: error }));
    return error === '';
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    validateField(name, value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user) {
      setStatus({ message: 'Você precisa estar logado para agendar.', type: 'error' });
      return;
    }

    const isFormValid = Object.keys(formData).every(field => 
      validateField(field, formData[field as keyof typeof formData])
    );

    if (!isFormValid) {
      setStatus({ message: 'Por favor, corrija os erros no formulário.', type: 'error' });
      return;
    }

    setIsSubmitting(true);

    try {
      const batch = writeBatch(db);
      
      const appRef = doc(collection(db, 'appointments'));
      batch.set(appRef, {
        patientId: user.uid,
        patientName: formData.nome,
        patientPhone: formData.telefone,
        specialty: formData.especialidade,
        date: formData.data,
        time: formData.hora,
        insurancePlan: formData.plano,
        status: 'scheduled',
        createdAt: serverTimestamp()
      });

      const slotRef = doc(collection(db, 'slots'));
      batch.set(slotRef, {
        appointmentId: appRef.id,
        date: formData.data,
        time: formData.hora
      });

      await batch.commit();

      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#2563eb', '#10b981']
      });

      setStatus({
        message: `Parabéns, ${formData.nome}! Sua consulta de ${formData.especialidade} foi agendada para ${formData.data} às ${formData.hora}.`,
        type: 'success'
      });
      setFormData({ 
        nome: user.displayName || '', 
        telefone: '', 
        especialidade: '', 
        data: '', 
        plano: '', 
        hora: '09:00' 
      });
      setErrors({});
    } catch (err: any) {
      console.error(err);
      setStatus({ message: 'Erro ao agendar consulta. Tente novamente.', type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const cancelAppointment = async (app: Appointment) => {
    if (!window.confirm('Deseja realmente cancelar este agendamento?')) return;
    try {
      const batch = writeBatch(db);
      
      batch.delete(doc(db, 'appointments', app.id));
      
      // Find the slot to delete
      const slotToDelete = slots.find(s => s.appointmentId === app.id);
      if (slotToDelete) {
        batch.delete(doc(db, 'slots', slotToDelete.id));
      }
      
      await batch.commit();
      setStatus({ message: 'Agendamento cancelado com sucesso.', type: 'success' });
    } catch (err) {
      console.error(err);
      setStatus({ message: 'Erro ao cancelar. Tente novamente.', type: 'error' });
    }
  };

  const calendarDays = useMemo(() => {
    const year = selectedDate.getFullYear();
    const month = selectedDate.getMonth();
    const firstDayOfMonth = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    const days = [];
    for (let i = 0; i < firstDayOfMonth; i++) {
      days.push(null);
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i));
    }
    return days;
  }, [selectedDate]);

  const changeMonth = (offset: number) => {
    setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + offset, 1));
  };

  const userAppointments = useMemo(() => {
    if (!user) return [];
    return appointments.filter(app => app.patientId === user.uid);
  }, [appointments, user]);

  if (authLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <Clock className="w-12 h-12 text-blue-600 animate-spin" />
          <p className="text-sm font-bold text-slate-500 uppercase tracking-widest">Iniciando VidaPlena...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-100 selection:text-blue-900">
      {/* Topbar */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <a href="#" className="text-2xl font-extrabold text-blue-600 tracking-tight">VidaPlena</a>
          <nav className="hidden md:flex items-center gap-8 text-sm font-semibold text-slate-600">
            <a href="#servicos" className="hover:text-blue-600 transition-colors">Serviços</a>
            <a href="#agenda" className="hover:text-blue-600 transition-colors">Agenda</a>
            {user ? (
              <div className="flex items-center gap-6">
                <a href="#meus-agendamentos" className="hover:text-blue-600 transition-colors text-xs font-bold uppercase">Meus Agendamentos</a>
                <button 
                  onClick={logout}
                  className="flex items-center gap-2 text-slate-400 hover:text-red-500 transition-colors"
                  title="Sair"
                >
                  <LogOut className="w-5 h-5" />
                </button>
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 border border-blue-200 overflow-hidden">
                  {user.photoURL ? <img src={user.photoURL} alt={user.displayName || ''} className="w-full h-full object-cover" /> : <UserIcon className="w-4 h-4" />}
                </div>
              </div>
            ) : (
              <button 
                onClick={signInWithGoogle}
                className="px-5 py-2.5 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-all shadow-md shadow-blue-200 flex items-center gap-2 text-sm font-bold"
              >
                Entrar com Google
              </button>
            )}
          </nav>
        </div>
      </header>

      <main>
        {/* Hero Section */}
        <section className="relative pt-20 pb-32 overflow-hidden">
          <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <motion.div 
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6 }}
              className="space-y-8"
            >
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-bold uppercase tracking-wider">
                <CheckCircle2 className="w-3 h-3" />
                Atendimento Humanizado
              </div>
              <h1 className="text-5xl lg:text-6xl font-extrabold leading-[1.1] tracking-tight">
                Cuidar da sua saúde <span className="text-blue-600">nunca foi tão simples</span>
              </h1>
              <p className="text-xl text-slate-500 leading-relaxed max-w-lg">
                Agende suas consultas online, acompanhe seu histórico e receba confirmações imediatas via WhatsApp.
              </p>
              {!user ? (
                <div className="flex flex-wrap gap-4 pt-4">
                  <button 
                    onClick={signInWithGoogle}
                    className="px-8 py-4 bg-blue-600 text-white rounded-2xl font-bold text-lg hover:bg-blue-700 transition-all shadow-xl shadow-blue-200 flex items-center gap-3 group"
                  >
                    Começar agora
                    <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-4 pt-4">
                  <a href="#agendar" className="px-8 py-4 bg-blue-600 text-white rounded-2xl font-bold text-lg hover:bg-blue-700 transition-all shadow-xl shadow-blue-200 flex items-center gap-2 group">
                    Novo Agendamento
                    <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </a>
                  <a href="#meus-agendamentos" className="px-8 py-4 bg-white text-slate-700 border border-slate-200 rounded-2xl font-bold text-lg hover:bg-slate-50 transition-all">
                    Ver meus horários
                  </a>
                </div>
              )}
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="relative"
            >
              <div className="bg-white rounded-[2.5rem] shadow-2xl p-8 border border-slate-100 relative z-10">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-xl font-bold">Agenda em tempo real</h2>
                  <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse"></div>
                </div>
                <div className="space-y-6">
                  <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 flex items-center gap-4">
                    <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center text-blue-600">
                      <Clock className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900">Slots Ocupados</p>
                      <p className="text-xs text-slate-500">{appointments.length} consultas marcadas na rede</p>
                    </div>
                  </div>
                  <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 flex items-center gap-4">
                    <div className="w-12 h-12 bg-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600">
                      <Users className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900">Especialistas</p>
                      <p className="text-xs text-slate-500">6 áreas com horários flexíveis</p>
                    </div>
                  </div>
                  <a href="#agenda" className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-all font-sans tracking-tight">
                    Ver agenda completa
                  </a>
                </div>
              </div>
              <div className="absolute -top-12 -right-12 w-64 h-64 bg-blue-100 rounded-full blur-3xl opacity-50 -z-10"></div>
              <div className="absolute -bottom-12 -left-12 w-64 h-64 bg-indigo-100 rounded-full blur-3xl opacity-50 -z-10"></div>
            </motion.div>
          </div>
        </section>

        {/* Meus Agendamentos */}
        {user && (
          <section id="meus-agendamentos" className="py-32 bg-white border-y border-slate-100">
            <div className="max-w-7xl mx-auto px-6">
              <div className="flex items-end justify-between mb-16">
                <div className="space-y-4">
                  <h2 className="text-4xl font-extrabold tracking-tight underline decoration-blue-600/30 underline-offset-8 decoration-4">Minhas Consultas</h2>
                  <p className="text-slate-500 text-lg">Gerencie seus horários marcados na unidade Paulista.</p>
                </div>
                <div className="px-5 py-2 bg-slate-50 border border-slate-200 rounded-full text-xs font-bold text-slate-400">
                  {userAppointments.length} REGISTRO(S)
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <AnimatePresence>
                  {userAppointments.map((app) => (
                    <motion.div 
                      key={app.id}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className="p-8 bg-slate-50 rounded-[2rem] border border-slate-100 space-y-6 relative group overflow-hidden hover:shadow-xl hover:shadow-blue-500/5 transition-all"
                    >
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <p className="text-xs font-bold text-blue-600 uppercase tracking-widest">{app.specialty}</p>
                          <h3 className="text-3xl font-bold">{app.time}</h3>
                          <p className="text-slate-400 font-medium">{new Date(app.date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })}</p>
                        </div>
                        <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-blue-600 shadow-sm border border-slate-100">
                          <HeartPulse className="w-6 h-6" />
                        </div>
                      </div>
                      <div className="pt-6 border-t border-slate-200 flex items-center justify-between">
                        <span className="text-xs font-bold py-1 px-3 bg-emerald-100 text-emerald-700 rounded-full uppercase">Atigo</span>
                        <button 
                          onClick={() => cancelAppointment(app)}
                          className="p-2 text-slate-300 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {userAppointments.length === 0 && (
                  <div className="col-span-full py-20 text-center border-2 border-dashed border-slate-100 rounded-[2rem]">
                    <p className="text-slate-400 font-bold italic">Nenhum agendamento ativo.</p>
                    <a href="#agendar" className="mt-4 inline-block text-blue-600 font-bold hover:underline">Marcar agora</a>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Agenda Pública */}
        <section id="agenda" className="py-32 bg-slate-50 border-b border-slate-200">
          <div className="max-w-7xl mx-auto px-6">
            <div className="text-center mb-16 space-y-4">
              <h2 className="text-4xl font-extrabold tracking-tight">Disponibilidade</h2>
              <p className="text-slate-500 text-lg">Os pontos azuis indicam horários já reservados.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-8 bg-white rounded-[2rem] p-8 shadow-sm border border-slate-200">
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-xl font-bold flex items-center gap-2 capitalize">
                    {selectedDate.toLocaleString('pt-BR', { month: 'long', year: 'numeric' })}
                  </h3>
                  <div className="flex gap-2">
                    <button onClick={() => changeMonth(-1)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button onClick={() => changeMonth(1)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-7 gap-2 mb-2">
                  {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(day => (
                    <div key={day} className="text-center text-xs font-bold text-slate-400 uppercase tracking-widest py-2">
                      {day}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-2">
                  {calendarDays.map((date, i) => {
                    if (!date) return <div key={i} className="aspect-square"></div>;
                    
                    const dateStr = date.toISOString().split('T')[0];
                    const dailySlots = slots.filter(slot => slot.date === dateStr);
                    const isToday = dateStr === new Date().toISOString().split('T')[0];
                    
                    return (
                      <div 
                        key={i} 
                        className={cn(
                          "aspect-square rounded-2xl border p-2 flex flex-col justify-between transition-all group cursor-pointer",
                          isToday ? "border-blue-500 bg-blue-50/30 shadow-inner" : "border-slate-100 hover:border-blue-200 hover:bg-slate-50"
                        )}
                      >
                        <span className={cn(
                          "text-sm font-bold",
                          isToday ? "text-blue-600" : "text-slate-700"
                        )}>{date.getDate()}</span>
                        <div className="flex flex-wrap gap-1">
                          {dailySlots.map(slot => (
                            <div key={slot.id} className="w-1.5 h-1.5 rounded-full bg-blue-500" title={`${slot.time} - Reservado`}></div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="lg:col-span-4 space-y-6">
                <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-200">
                  <h3 className="font-bold mb-4 flex items-center gap-2">
                    <CalendarCheck className="w-5 h-5 text-blue-600" />
                    Horários Ocupados Hoje
                  </h3>
                  <div className="space-y-4">
                    {slots
                      .filter(slot => slot.date === new Date().toISOString().split('T')[0])
                      .sort((a, b) => a.time.localeCompare(b.time))
                      .map(slot => (
                        <div key={slot.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                          <div>
                            <p className="text-xs font-bold text-blue-600">{slot.time}</p>
                            <p className="text-sm font-bold text-slate-800">Sistema Bloqueado</p>
                          </div>
                          <div className="px-2 py-1 bg-white rounded-lg text-[10px] font-bold text-slate-400 uppercase tracking-tight border border-slate-100">
                            BUSY
                          </div>
                        </div>
                      ))}
                    {slots.filter(slot => slot.date === new Date().toISOString().split('T')[0]).length === 0 && (
                      <p className="text-sm text-slate-500 italic">Nenhuma reserva para hoje.</p>
                    )}
                  </div>
                  <div className="mt-8 pt-8 border-t border-slate-100 space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                      <span className="text-xs font-bold text-slate-600">Horário Com Agendamento</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full border border-blue-500"></div>
                      <span className="text-xs font-bold text-slate-600">Livre para Escolha</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Agendar */}
        <section id="agendar" className="py-32 bg-white overflow-hidden">
          <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div className="space-y-8">
              <h2 className="text-4xl font-extrabold tracking-tight leading-tight">
                Selecione seu <span className="text-blue-600">horário ideal</span>
              </h2>
              <p className="text-slate-500 text-lg leading-relaxed">
                As vagas são preenchidas rapidamente. Garante sua consulta logando na plataforma.
              </p>
              {!user && (
                <div className="p-8 bg-blue-50 rounded-3xl border border-blue-100 space-y-4">
                  <p className="text-sm font-bold text-blue-700">Autenticação Necessária</p>
                  <p className="text-xs text-blue-600 leading-relaxed font-medium">
                    Para agendar e ter um painel de controle dos seus horários, entre com sua conta do Google.
                  </p>
                  <button 
                    onClick={signInWithGoogle}
                    className="w-full py-4 bg-white text-blue-600 rounded-xl text-sm font-bold border border-blue-200 hover:bg-blue-100 transition-all shadow-md active:scale-95"
                  >
                    Entrar com Google
                  </button>
                </div>
              )}
              <ul className="space-y-4">
                {[
                  'Painel de controle de consultas',
                  'Cancelamento simplificado',
                  'Histórico médico digital',
                  'Confirmado via WhatsApp em segundos'
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 font-semibold text-slate-700">
                    <div className="w-6 h-6 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600">
                      <CheckCircle2 className="w-4 h-4" />
                    </div>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className={cn(
                "bg-white rounded-[2.5rem] shadow-[0_32px_64px_-12px_rgba(0,0,0,0.1)] p-8 md:p-12 border border-slate-100 transition-all",
                !user && "opacity-40 pointer-events-none select-none grayscale"
              )}
            >
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2">
                  <label htmlFor="nome" className="text-sm font-bold text-slate-700 ml-1 uppercase tracking-wider text-[10px]">Nome do Paciente</label>
                  <input 
                    id="nome" name="nome" type="text" required
                    placeholder="Quem será atendido?"
                    value={formData.nome}
                    onChange={handleInputChange}
                    className={cn(
                      "w-full px-6 py-4 bg-slate-50 border rounded-2xl focus:ring-4 transition-all outline-none",
                      errors.nome ? "border-red-300 focus:ring-red-500/10 focus:border-red-500" : "border-slate-200 focus:ring-blue-500/10 focus:border-blue-500"
                    )}
                  />
                  {errors.nome && <p className="text-[10px] text-red-500 font-bold ml-2">{errors.nome}</p>}
                </div>
                <div className="space-y-2">
                  <label htmlFor="telefone" className="text-sm font-bold text-slate-700 ml-1 uppercase tracking-wider text-[10px]">WhatsApp</label>
                  <input 
                    id="telefone" name="telefone" type="tel" required
                    placeholder="(11) 99999-9999"
                    value={formData.telefone}
                    onChange={handleInputChange}
                    className={cn(
                      "w-full px-6 py-4 bg-slate-50 border rounded-2xl focus:ring-4 transition-all outline-none",
                      errors.telefone ? "border-red-300 focus:ring-red-500/10 focus:border-red-500" : "border-slate-200 focus:ring-blue-500/10 focus:border-blue-500"
                    )}
                  />
                  {errors.telefone && <p className="text-[10px] text-red-500 font-bold ml-2">{errors.telefone}</p>}
                </div>
                <div className="space-y-2">
                  <label htmlFor="plano" className="text-sm font-bold text-slate-700 ml-1 uppercase tracking-wider text-[10px]">Plano Escolhido</label>
                  <select 
                    id="plano" name="plano" required
                    value={formData.plano}
                    onChange={handleInputChange}
                    className={cn(
                      "w-full px-6 py-4 bg-slate-50 border rounded-2xl focus:ring-4 transition-all outline-none appearance-none cursor-pointer",
                      errors.plano ? "border-red-300 focus:ring-red-500/10 focus:border-red-500" : "border-slate-200 focus:ring-blue-500/10 focus:border-blue-500"
                    )}
                  >
                    <option value="">Selecione Convênio</option>
                    <option value="Amil">Amil</option>
                    <option value="Unimed">Unimed</option>
                    <option value="SulAmérica">SulAmérica</option>
                    <option value="Particular">Particular</option>
                  </select>
                  {errors.plano && <p className="text-[10px] text-red-500 font-bold ml-2">{errors.plano}</p>}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label htmlFor="especialidade" className="text-sm font-bold text-slate-700 ml-1 uppercase tracking-wider text-[10px]">Especialidade</label>
                    <select 
                      id="especialidade" name="especialidade" required
                      value={formData.especialidade}
                      onChange={handleInputChange}
                      className={cn(
                        "w-full px-6 py-4 bg-slate-50 border rounded-2xl focus:ring-4 transition-all outline-none appearance-none cursor-pointer",
                        errors.especialidade ? "border-red-300 focus:ring-red-500/10 focus:border-red-500" : "border-slate-200 focus:ring-blue-500/10 focus:border-blue-500"
                      )}
                    >
                      <option value="">Área</option>
                      {specialties.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                    </select>
                    {errors.especialidade && <p className="text-[10px] text-red-500 font-bold ml-2">{errors.especialidade}</p>}
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="data" className="text-sm font-bold text-slate-700 ml-1 uppercase tracking-wider text-[10px]">Data</label>
                    <input 
                      id="data" name="data" type="date" required
                      min={new Date().toISOString().split('T')[0]}
                      value={formData.data}
                      onChange={handleInputChange}
                      className={cn(
                        "w-full px-6 py-4 bg-slate-50 border rounded-2xl focus:ring-4 transition-all outline-none cursor-pointer",
                        errors.data ? "border-red-300 focus:ring-red-500/10 focus:border-red-500" : "border-slate-200 focus:ring-blue-500/10 focus:border-blue-500"
                      )}
                    />
                    {errors.data && <p className="text-[10px] text-red-500 font-bold ml-2">{errors.data}</p>}
                  </div>
                </div>

                <div className="space-y-2">
                  <label htmlFor="hora" className="text-sm font-bold text-slate-700 ml-1 uppercase tracking-wider text-[10px]">Escolha o Horário</label>
                  <select 
                    id="hora" name="hora" required
                    value={formData.hora}
                    onChange={handleInputChange}
                    className={cn(
                      "w-full px-6 py-4 bg-slate-50 border rounded-2xl focus:ring-4 transition-all outline-none appearance-none cursor-pointer",
                      errors.hora ? "border-red-300 focus:ring-red-500/10 focus:border-red-500" : "border-slate-200 focus:ring-blue-500/10 focus:border-blue-500"
                    )}
                  >
                    {timeSlots.map(slot => (
                      <option 
                        key={slot} 
                        value={slot}
                        disabled={slots.some(s => s.date === formData.data && s.time === slot)}
                      >
                        {slot} {slots.some(s => s.date === formData.data && s.time === slot) ? '(Reservado)' : ''}
                      </option>
                    ))}
                  </select>
                  {errors.hora && <p className="text-[10px] text-red-500 font-bold ml-2">{errors.hora}</p>}
                </div>

                <button 
                  type="submit" 
                  disabled={isSubmitting}
                  className="w-full py-6 bg-blue-600 text-white rounded-[1.5rem] font-extrabold text-lg flex items-center justify-center gap-3 hover:bg-blue-700 transition-all shadow-xl shadow-blue-200 disabled:opacity-50 active:scale-95"
                >
                  {isSubmitting ? <Clock className="w-6 h-6 animate-spin" /> : <CalendarIcon className="w-6 h-6" />}
                  {isSubmitting ? 'Reservando...' : 'Confirmar Agendamento'}
                </button>

                {status.type && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className={cn(
                      "p-4 rounded-2xl text-sm font-bold text-center",
                      status.type === 'success' ? "bg-emerald-50 text-emerald-700 font-sans" : "bg-red-50 text-red-700"
                    )}
                  >
                    {status.message}
                  </motion.div>
                )}
              </form>
            </motion.div>
          </div>
        </section>
      </main>

      <footer className="bg-slate-900 py-20 mt-20">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-3 gap-16 border-b border-slate-800 pb-16">
          <div className="space-y-6">
            <h3 className="text-2xl font-extrabold text-white">VidaPlena</h3>
            <p className="text-slate-400 leading-relaxed text-sm">
              Inovação em saúde com atendimento humano. Rede Paulista de Atendimento Médico.
            </p>
          </div>
          <div className="space-y-6">
            <h4 className="text-lg font-bold text-white">Central</h4>
            <ul className="space-y-3 text-slate-400 text-sm">
              <li className="flex items-center gap-2 font-mono"><Phone className="w-4 h-4" /> (11) 99999-9999</li>
              <li className="flex items-center gap-2"><MapPin className="w-4 h-4" /> Av. Paulista, 1000</li>
            </ul>
          </div>
          <div className="space-y-6">
            <h4 className="text-lg font-bold text-white">Plantão</h4>
            <ul className="space-y-2 text-slate-400 text-sm">
              <li>Segunda a Sexta: 08h às 20h</li>
              <li>Sábados: 08h às 13h</li>
            </ul>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-6 pt-12 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-slate-500 text-[10px] text-center md:text-left uppercase tracking-widest font-bold">
            © {new Date().getFullYear()} VidaPlena Clínica Médica.
          </p>
          <div className="flex items-center gap-6 text-slate-500 text-[10px] font-bold uppercase tracking-widest">
            <a href="#" className="hover:text-white transition-colors">Privacidade</a>
            <a href="#" className="hover:text-white transition-colors">Termos</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
