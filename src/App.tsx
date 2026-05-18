import React, { useState, useEffect, useMemo } from 'react';
import { Trophy, Calendar, Search, Users, Award, Play, CheckCircle, Crown, Trash2, X, LogIn, LogOut, Globe, Clock, Plus, ArrowLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import { Match, Team, TournamentState, MatchType, AppMode, RosterPlayer } from './types';
import { calculatePointsTable, generateLeagueMatches, calculatePlayerStats, calculateCareerStats } from './utils';
import { auth, db, signIn, logOut } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { 
    collection, 
    addDoc, 
    updateDoc, 
    doc, 
    onSnapshot, 
    query, 
    where, 
    orderBy,
    getDocs,
    deleteDoc,
    serverTimestamp,
    getDoc,
    increment,
    getDocFromServer
} from 'firebase/firestore';

const STORAGE_KEY = "cricket_tourney_data_react";

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
  }
}

const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // Not throwing to prevent app crash, instead we could use a toast or alert
  alert(`PERMISSION ERROR: ${errInfo.error}\nPath: ${path}\nAction: ${operationType}`);
};

const App: React.FC = () => {
    const [user, setUser] = useState<User | null>(null);
    const [appMode, setAppMode] = useState<AppMode | null>(null);
    const [showPlayerManager, setShowPlayerManager] = useState(false);
    const [userPlayers, setUserPlayers] = useState<RosterPlayer[]>([]);
    const [cloudTournaments, setCloudTournaments] = useState<TournamentState[]>([]);
    const [loading, setLoading] = useState(true);

    const [state, setState] = useState<TournamentState>(() => {
        const saved = localStorage.getItem(STORAGE_KEY);
        const savedMode = localStorage.getItem(STORAGE_KEY + "_mode") as AppMode;
        
        if (saved) {
            const parsed = JSON.parse(saved);
            if (savedMode) setAppMode(savedMode);
            return parsed;
        }
        return {
            active: false,
            name: "",
            teamCount: 0,
            teams: [],
            matches: [],
            playoffs: { champion: null }
        };
    });

    // Auth Observer
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (u) => {
            setUser(u);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    // Cloud Tournaments Observer
    useEffect(() => {
        const qPublic = query(collection(db, "tournaments"), where("isPublic", "==", true));
        const unsubscribePublic = onSnapshot(qPublic, (snapshot) => {
            const publicDocs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as TournamentState));
            setCloudTournaments(prev => {
                const map = new Map<string, TournamentState>(prev.map(t => [t.id!, t]));
                publicDocs.forEach(t => map.set(t.id!, t));
                return Array.from(map.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            });
        }, (error) => {
            handleFirestoreError(error, OperationType.LIST, "public/tournaments");
        });

        let unsubscribeUser: (() => void) | undefined;
        if (user) {
            const qUser = query(collection(db, "tournaments"), where("creatorId", "==", user.uid));
            unsubscribeUser = onSnapshot(qUser, (snapshot) => {
                const userDocs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as TournamentState));
                setCloudTournaments(prev => {
                    const map = new Map<string, TournamentState>(prev.map(t => [t.id!, t]));
                    userDocs.forEach(t => map.set(t.id!, t));
                    return Array.from(map.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
                });
            }, (error) => {
                handleFirestoreError(error, OperationType.LIST, "user/tournaments");
            });
        }

        return () => {
            unsubscribePublic();
            if (unsubscribeUser) unsubscribeUser();
        };
    }, [user]);

    // Roster Sync: Cloud vs Local
    useEffect(() => {
        if (user) {
            const q = query(collection(db, "players"), where("creatorId", "==", user.uid));
            const unsubscribe = onSnapshot(q, (snapshot) => {
                const players = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as RosterPlayer));
                setUserPlayers(players);
            }, (error) => {
                handleFirestoreError(error, OperationType.LIST, "players");
            });
            return () => unsubscribe();
        } else {
            const savedPlayers = localStorage.getItem(STORAGE_KEY + "_players");
            if (savedPlayers) {
                setUserPlayers(JSON.parse(savedPlayers));
            } else {
                setUserPlayers([]);
            }
        }
    }, [user]);

    // Connect Test
    useEffect(() => {
        const testConnection = async () => {
          try {
            await getDocFromServer(doc(db, 'test', 'connection'));
          } catch (error: any) {
            if(error?.message?.includes('offline')) {
              console.error("Firebase appears to be offline. Check configuration.");
            }
          }
        };
        testConnection();
    }, []);

    useEffect(() => {
        if (appMode === 'cloud' && state.id) {
            const unsubscribe = onSnapshot(doc(db, "tournaments", state.id), (d) => {
                if (d.exists()) {
                    setState(prev => ({ ...prev, ...d.data() as TournamentState }));
                }
            }, (error) => {
                handleFirestoreError(error, OperationType.GET, `tournaments/${state.id}`);
            });
            return () => unsubscribe();
        }
    }, [appMode, state.id]);

    const [activeTab, setActiveTab] = useState<'fixtures' | 'table' | 'playoffs' | 'leaders'>('fixtures');
    const [searchTerm, setSearchTerm] = useState("");
    const [editingMatch, setEditingMatch] = useState<Match | null>(null);
    const [leaderMode, setLeaderMode] = useState<'current' | 'career'>('current');

    // Persist State
    useEffect(() => {
        if (state.active) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            if (appMode) localStorage.setItem(STORAGE_KEY + "_mode", appMode);
        }
    }, [state, appMode]);

    // Save Local Roster
    useEffect(() => {
        if (!user) {
            localStorage.setItem(STORAGE_KEY + "_players", JSON.stringify(userPlayers));
        }
    }, [userPlayers, user]);

    // Handle Mode Switching logic
    const selectMode = (mode: AppMode) => {
        if (mode === 'timepass') {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                setState(JSON.parse(saved));
            } else {
                setState({
                    active: false,
                    name: "",
                    teamCount: 0,
                    teams: [],
                    matches: [],
                    playoffs: { champion: null }
                });
            }
        }
        setAppMode(mode);
    };

    // Derived State
    const pointsTable = useMemo(() => calculatePointsTable(state.teams, state.matches), [state.teams, state.matches]);
    const playerStats = useMemo(() => {
        if (leaderMode === 'career') {
            return calculateCareerStats(cloudTournaments);
        }
        return calculatePlayerStats(state.teams, state.matches);
    }, [leaderMode, state.teams, state.matches, cloudTournaments]);
    
    const leagueMatches = state.matches.filter(m => m.type === 'league');
    const semiMatches = state.matches.filter(m => m.type === 'semi-final');
    const finalMatch = state.matches.find(m => m.type === 'final');

    const completedLeagueCount = leagueMatches.filter(m => m.status === 'completed').length;
    const isLeagueComplete = leagueMatches.length > 0 && completedLeagueCount === leagueMatches.length;

    // Handlers
    const [isLaunching, setIsLaunching] = useState(false);
    const handleLaunch = async (name: string, teamData: { name: string; players: string[] }[]) => {
        if (!name.trim()) return alert("Give your tournament a legendary name!");
        if (teamData.some(t => !t.name.trim())) return alert("All teams must have names!");
        
        setIsLaunching(true);
        console.log("handleLaunch initiated with mode:", appMode);
        
        try {
            if (appMode === 'cloud' && !user) {
                setIsLaunching(false);
                return alert("AUTHENTICATION REQUIRED: Please sign in to launch a Cloud Tournament.");
            }
            const teamNames = teamData.map(t => t.name.trim());
            const newTeams: Team[] = teamData.map(t => ({
                name: t.name.trim(), 
                played: 0, won: 0, lost: 0, tied: 0, pts: 0,
                runsScored: 0, oversFaced: 0, runsConceded: 0, oversBowled: 0, nrr: 0,
                players: t.players.map(p => p.trim()).filter(p => p !== "")
            }));
            
            const newMatches = generateLeagueMatches(teamNames);
            
            const newState: TournamentState = {
                active: true,
                name: name.trim(),
                teamCount: teamNames.length,
                teams: newTeams,
                matches: newMatches,
                playoffs: { champion: null },
                createdAt: Date.now(),
                isPublic: true,
                status: 'live'
            };

            if (appMode === 'cloud' && user) {
                const cloudState = {
                    ...newState,
                    creatorId: user.uid,
                    creatorEmail: user.email || "Unknown",
                    isPublic: true,
                    status: 'live',
                    createdAt: serverTimestamp() // Use server timestamp for consistency
                };
                console.log("DEBUG: Attempting cloud launch...");
                const docRef = await addDoc(collection(db, "tournaments"), cloudState);
                console.log("Cloud tournament launched successfully. Doc ID:", docRef.id);
                setState({ ...cloudState, id: docRef.id, createdAt: Date.now() } as TournamentState);
            } else {
                console.log("Launching local tournament...");
                setState(newState);
            }
        } catch (error) {
            console.error("Critical Launch Error:", error);
            handleFirestoreError(error, OperationType.WRITE, "tournaments");
            alert("Launch Failed! Check console for details.");
        } finally {
            setIsLaunching(false);
        }
    };

    const handleUpdateResult = async (matchId: number, results: Partial<Match>) => {
        let championName: string | null = null;
        
        const updatedMatches = state.matches.map(m => {
            if (m.id === matchId) {
                const updated = { ...m, ...results, status: 'completed' as const };
                if (updated.team1Score > updated.team2Score) updated.winner = updated.team1;
                else if (updated.team2Score > updated.team1Score) updated.winner = updated.team2;
                else updated.winner = "Tie";
                
                if (updated.type === 'final' && updated.winner && updated.winner !== 'Tie') {
                    championName = updated.winner;
                }
                return updated;
            }
            return m;
        });

        // Auto-generate Qualifier 1 if league complete
        let finalMatches = updatedMatches;
        const currentMatch = updatedMatches.find(m => m.id === matchId);
        
        if (currentMatch?.type === 'league') {
             const allLeagueDone = updatedMatches.filter(m => m.type === 'league').every(m => m.status === 'completed');
             const hasPlayoffs = updatedMatches.some(m => m.type !== 'league');
             if (allLeagueDone && !hasPlayoffs) {
                 const top3 = calculatePointsTable(state.teams, updatedMatches).slice(0, 3);
                 if (top3.length >= 2) {
                     const q1: Match = { 
                        id: updatedMatches.length + 1, 
                        team1: top3[0].name, 
                        team2: top3[1].name, 
                        team1Score: 0, team1Wickets: 0, team2Score: 0, team2Wickets: 0, team1Overs: 0, team2Overs: 0, 
                        quota: 20, status: 'upcoming' as const, winner: null, 
                        type: 'semi-final' as MatchType // Reusing type for UI simplicity but will label as Qualifier
                     };
                     finalMatches = [...updatedMatches, q1];
                 }
             }
        }

        // Auto-generate Semi-Final after Qualifier 1
        if (currentMatch?.type === 'semi-final' && updatedMatches.filter(m => m.type === 'semi-final').length === 1) {
            const q1 = currentMatch;
            const rank3 = calculatePointsTable(state.teams, updatedMatches)[2];
            const loser = q1.winner === q1.team1 ? q1.team2 : q1.team1;
            
            if (rank3) {
                const sf: Match = { 
                    id: updatedMatches.length + 1, 
                    team1: loser, 
                    team2: rank3.name, 
                    team1Score: 0, team1Wickets: 0, team2Score: 0, team2Wickets: 0, team1Overs: 0, team2Overs: 0, 
                    quota: 20, status: 'upcoming' as const, winner: null, 
                    type: 'semi-final' as MatchType 
                };
                finalMatches = [...updatedMatches, sf];
            }
        }

        // Auto-generate final if both semis (Qualifier and Semi) are complete
        const semis = finalMatches.filter(m => m.type === 'semi-final');
        if (semis.length === 2 && semis.every(m => m.status === 'completed')) {
            const hasFinal = finalMatches.some(m => m.type === 'final');
            if (!hasFinal) {
                const q1Winner = semis[0].winner;
                const sfWinner = semis[1].winner;
                if (q1Winner && sfWinner && q1Winner !== 'Tie' && sfWinner !== 'Tie') {
                    const final: Match = { 
                        id: finalMatches.length + 1, 
                        team1: q1Winner, 
                        team2: sfWinner, 
                        team1Score: 0, team1Wickets: 0, team2Score: 0, team2Wickets: 0, team1Overs: 0, team2Overs: 0, 
                        quota: 20, status: 'upcoming' as const, winner: null, 
                        type: 'final' as MatchType 
                    };
                    finalMatches = [...finalMatches, final];
                }
            }
        }

        const finalChampion = championName || state.playoffs.champion;

        // Career Sync and Tournament Completion logic
        if (appMode === 'cloud' && state.id) {
            try {
                const tournamentRef = doc(db, "tournaments", state.id);
                const updatePayload: any = {
                    matches: finalMatches,
                    playoffs: { champion: finalChampion }
                };

                // If tournament just finished (champion crowned), calculate Caps
                if (championName) {
                    const allStats = calculatePlayerStats(state.teams, finalMatches);
                    const topScorer = allStats[0]?.name;
                    const topWicketer = [...allStats].sort((a,b) => b.wickets - a.wickets)[0]?.name;
                    
                    if (topScorer) updatePayload.orangeCap = topScorer;
                    if (topWicketer) updatePayload.purpleCap = topWicketer;
                    updatePayload.status = 'completed';

                    // Update Caps in Player Roster
                    const syncCaps = async (name: string, type: 'orange' | 'purple') => {
                        const playerDocId = userPlayers.find(p => p.name.toLowerCase() === name.toLowerCase())?.id;
                        if (playerDocId) {
                            await updateDoc(doc(db, "players", playerDocId), {
                                [type === 'orange' ? 'orangeCaps' : 'purpleCaps']: increment(1)
                            });
                        }
                    };
                    if (topScorer) await syncCaps(topScorer, 'orange');
                    if (topWicketer) await syncCaps(topWicketer, 'purple');
                }

                await updateDoc(tournamentRef, updatePayload);

                // SYNC MATCH STATS TO PLAYER ROSTER - ONLY IF NOT ALREADY COMPLETED
                const originalMatch = state.matches.find(m => m.id === matchId);
                const matchResults = finalMatches.find(m => m.id === matchId);
                
                if (originalMatch?.status !== 'completed' && matchResults?.status === 'completed' && matchResults.playerPerformances) {
                    const allMatchPerfs = [
                        ...matchResults.playerPerformances.team1Players,
                        ...matchResults.playerPerformances.team2Players
                    ];

                    for (const perf of allMatchPerfs) {
                        const playerDoc = userPlayers.find(p => p.name.toLowerCase() === perf.playerName.toLowerCase());
                        if (playerDoc) {
                            try {
                                await updateDoc(doc(db, "players", playerDoc.id), {
                                    careerRuns: increment(perf.runs || 0),
                                    careerWickets: increment(perf.wickets || 0),
                                    careerMatches: increment(1),
                                    careerBalls: increment(perf.balls || 0)
                                });
                            } catch (e) {
                                console.error("Error syncing player career stats:", e);
                            }
                        }
                    }
                }

            } catch (error) {
                handleFirestoreError(error, OperationType.WRITE, `tournaments/${state.id}`);
            }
        } else {
            setState(prev => ({ 
                ...prev, 
                matches: finalMatches,
                playoffs: { champion: finalChampion }
            }));
        }
        
        if (championName) showConfetti();
        setEditingMatch(null);
    };

    const confirmReset = async () => {
        if (window.confirm("🚨 Are you sure you want to delete this tournament?")) {
            if (appMode === 'cloud' && state.id) {
                try {
                    await deleteDoc(doc(db, "tournaments", state.id));
                } catch (error) {
                    handleFirestoreError(error, OperationType.DELETE, `tournaments/${state.id}`);
                }
            }
            localStorage.removeItem(STORAGE_KEY);
            setState({
                active: false,
                name: "",
                teamCount: 0,
                teams: [],
                matches: [],
                playoffs: { champion: null }
            });
            setAppMode(null);
        }
    };

    const showConfetti = () => {
        const duration = 5 * 1000;
        const end = Date.now() + duration;

        (function frame() {
            confetti({ particleCount: 5, angle: 60, spread: 55, origin: { x: 0 }, colors: ['#002855', '#f9cd05', '#ffffff'] });
            confetti({ particleCount: 5, angle: 120, spread: 55, origin: { x: 1 }, colors: ['#002855', '#f9cd05', '#ffffff'] });
            if (Date.now() < end) requestAnimationFrame(frame);
        }());
    };

    const handleClearLocal = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (window.confirm("🗑️ Permanent Wipe: Delete your local tournament data?")) {
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(STORAGE_KEY + "_mode");
            localStorage.removeItem(STORAGE_KEY + "_players");
            setState({ active: false, name: "", teamCount: 0, teams: [], matches: [], playoffs: { champion: null } });
            setAppMode(null);
            setUserPlayers([]);
            window.location.reload(); 
        }
    };

    const handleViewTournament = (t: TournamentState) => {
        setAppMode('cloud');
        setState(t);
        setActiveTab('fixtures');
    };

    const isCreator = appMode === 'cloud' && user && state.creatorId === user.uid;
    const canEdit = appMode === 'timepass' || isCreator;

    if (loading) return <div className="h-screen flex items-center justify-center bg-gray-50 font-bold text-navy animate-pulse uppercase tracking-[0.2em]">STUMPS BEYOND BOOTING...</div>;

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            {/* Navbar */}
            <nav className="navbar sticky top-0 z-50 py-3 shadow-lg">
                <div className="container mx-auto px-4 flex justify-between items-center">
                    <div className="flex items-center gap-3 cursor-pointer" onClick={() => { setAppMode(null); setState({ active: false, name: "", teamCount: 0, teams: [], matches: [], playoffs: { champion: null } }); }}>
                        <div className="logo-box p-2 bg-white/20 rounded">
                            <Trophy size={24} color="#f9cd05" />
                        </div>
                        <span className="brand-text text-uppercase text-2xl font-black italic tracking-tighter">STUMPS <span className="text-amber-400">BEYOND</span></span>
                    </div>
                    
                    <div className="flex items-center gap-4">
                        {!user ? (
                            <button onClick={signIn} className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-full text-[10px] font-black transition-all border border-white/20 uppercase tracking-widest">
                                <LogIn size={12} /> AUTHENTICATE
                            </button>
                        ) : (
                            <div className="flex items-center gap-3">
                                <span className="text-white text-[10px] font-black hidden lg:block uppercase tracking-widest bg-white/10 px-3 py-1 rounded-full">{user.email}</span>
                                <button onClick={logOut} className="p-2 bg-red-500/20 rounded-full text-white hover:bg-red-500/50 transition-all border border-red-500/30">
                                    <LogOut size={14} />
                                </button>
                            </div>
                        )}
                        {state.active && canEdit && (
                            <button onClick={confirmReset} className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-black py-1.5 px-4 rounded text-[10px] shadow-lg uppercase tracking-widest transition-all active:scale-95">
                                <Trash2 size={12} /> {appMode === 'cloud' ? 'PURGE CLOUD' : 'WIPE LOCAL'}
                            </button>
                        )}
                    </div>
                </div>
            </nav>

            <main className="flex-1 container mx-auto px-4 py-8">
                {!appMode ? (
                    <LandingPage 
                        cloudTournaments={cloudTournaments} 
                        onSelectMode={(mode) => {
                            if (mode === 'cloud' && !user) {
                                signIn();
                            } else {
                                selectMode(mode);
                            }
                        }}
                        onViewTournament={handleViewTournament}
                        user={user}
                        onManagePlayers={() => setShowPlayerManager(true)}
                        onClearLocal={handleClearLocal}
                    />
                ) : !state.active ? (
                    <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
                        <button onClick={() => setAppMode(null)} className="mb-8 flex items-center gap-2 text-navy font-black text-[10px] uppercase hover:gap-3 transition-all bg-white px-4 py-2 rounded-full border shadow-sm w-fit">
                            <ArrowLeft size={14} /> Back to Dashboard
                        </button>
                        <SetupForm 
                            onLaunch={handleLaunch} 
                            isLaunching={isLaunching} 
                            roster={userPlayers} 
                            openRoster={() => setShowPlayerManager(true)}
                        />
                    </motion.div>
                ) : (
                    <div className="animate-up">
                        {/* Title Bar */}
                        <div className="mb-12 text-center relative">
                            <div className="flex justify-center flex-wrap gap-4 mb-4">
                                {appMode === 'cloud' ? (
                                    <span className="flex items-center gap-2 bg-blue-50 text-blue-800 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border border-blue-200">
                                        <Globe size={12} /> PRO TOURNAMENT
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-2 bg-amber-50 text-amber-800 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border border-amber-200">
                                        <Clock size={12} /> TIMEPASS MODE
                                    </span>
                                )}
                                {!canEdit && (
                                    <span className="flex items-center gap-2 bg-gray-100 text-gray-500 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border border-gray-200">
                                        VIEW ONLY
                                    </span>
                                )}
                            </div>
                            <h2 className="text-navy text-5xl md:text-6xl font-black uppercase italic tracking-tighter leading-none" id="display-tournament-name">{state.name}</h2>
                            <div className="h-1.5 w-32 bg-amber-400 mx-auto mt-4 rounded-full"></div>
                        </div>

                        {/* Stats Summary */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
                            <StatCard label="Qualifiers" value={leagueMatches.length} />
                            <StatCard label="Results In" value={completedLeagueCount} color="var(--success-green)" />
                            <StatCard label="Franchises" value={state.teamCount} />
                            <StatCard label="Leader" value={pointsTable[0]?.name || "---"} isGold />
                        </div>

                        {/* Tabs */}
                        <div className="flex justify-center mb-8 px-4">
                            <div className="bg-white p-1 rounded border shadow-sm flex gap-1 nav-pills-custom">
                                <TabButton active={activeTab === 'fixtures'} onClick={() => setActiveTab('fixtures')}>Fixtures</TabButton>
                                <TabButton active={activeTab === 'table'} onClick={() => setActiveTab('table')}>Point Standings</TabButton>
                                <TabButton active={activeTab === 'playoffs'} onClick={() => setActiveTab('playoffs')}>Playoffs</TabButton>
                                <TabButton active={activeTab === 'leaders'} onClick={() => setActiveTab('leaders')}>Leaders</TabButton>
                            </div>
                        </div>

                        {/* Tab Content */}
                        <div className="tab-content">
                            {activeTab === 'fixtures' && (
                                <section id="fixtures">
                                    <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4 bg-white p-4 rounded border shadow-sm">
                                        <h4 className="text-xl font-bold text-navy flex items-center gap-2">
                                            <Calendar className="text-blue-600" /> League Schedule
                                        </h4>
                                        <div className="relative w-full max-w-xs">
                                            <input 
                                                type="text" 
                                                className="w-full pl-10 pr-4 py-2 border-2 rounded focus:border-blue-500 outline-none transition-all"
                                                placeholder="Search by team..."
                                                value={searchTerm}
                                                onChange={(e) => setSearchTerm(e.target.value)}
                                            />
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                                        </div>
                                    </div>
                                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                                        {leagueMatches.filter(m => 
                                            m.team1.toLowerCase().includes(searchTerm.toLowerCase()) || 
                                            m.team2.toLowerCase().includes(searchTerm.toLowerCase())
                                        ).map(match => (
                                            <MatchCard 
                                                key={match.id} 
                                                match={match} 
                                                onEdit={() => setEditingMatch(match)} 
                                            />
                                        ))}
                                    </div>
                                </section>
                            )}

                            {activeTab === 'table' && (
                                <section id="points-table">
                                    <div className="pro-card overflow-hidden">
                                        <div className="overflow-x-auto">
                                            <table className="bcci-table">
                                                <thead>
                                                    <tr>
                                                        <th className="text-center">Pos</th>
                                                        <th className="text-left">Team</th>
                                                        <th className="text-center">P</th>
                                                        <th className="text-center">W</th>
                                                        <th className="text-center">L</th>
                                                        <th className="text-center">T</th>
                                                        <th className="text-center">NRR</th>
                                                        <th className="text-center">Pts</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {pointsTable.map((team, idx) => (
                                                        <tr key={team.name} className={idx === 0 ? 'top-team' : ''}>
                                                            <td className="text-center font-bold text-navy">{idx + 1}</td>
                                                            <td className="text-left font-bold text-navy">{team.name}</td>
                                                            <td className="text-center">{team.played}</td>
                                                            <td className="text-center text-green-700 font-bold">{team.won}</td>
                                                            <td className="text-center text-red-600">{team.lost}</td>
                                                            <td className="text-center">{team.tied}</td>
                                                            <td className="text-center text-gray-400 text-sm">{team.nrr}</td>
                                                            <td className="text-center font-bold text-lg text-navy">{team.pts}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </section>
                            )}

                            {activeTab === 'leaders' && (
                                <section id="player-leaders">
                                    <div className="flex justify-center mb-10">
                                        <div className="bg-white p-1.5 rounded-full border shadow-sm flex gap-2">
                                            <button 
                                                onClick={() => setLeaderMode('current')}
                                                className={`px-6 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${leaderMode === 'current' ? 'bg-navy text-white shadow-lg' : 'bg-transparent text-gray-400 hover:text-navy'}`}
                                            >
                                                This Tournament
                                            </button>
                                            <button 
                                                onClick={() => setLeaderMode('career')}
                                                className={`px-6 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${leaderMode === 'career' ? 'bg-amber-400 text-navy shadow-lg' : 'bg-transparent text-gray-400 hover:text-navy'}`}
                                            >
                                                Career Rankings
                                            </button>
                                        </div>
                                    </div>
                                    <div className="grid md:grid-cols-2 gap-8">
                                        <div className="pro-card p-6">
                                            <h4 className="text-xl font-bold text-navy mb-6 flex items-center gap-2">
                                                <Award className="text-amber-500" /> {leaderMode === 'career' ? 'All-Time Runs' : 'Orange Cap (Top Batsmen)'}
                                            </h4>
                                            <div className="space-y-4">
                                                {playerStats.filter(p => p.runs > 0).slice(0, 10).map((player, idx) => (
                                                    <div key={idx} className="flex justify-between items-center p-3 bg-gray-50 rounded border hover:border-amber-400 transition-colors">
                                                        <div className="flex items-center gap-4">
                                                            <span className="text-xl font-black text-gray-200 w-6">#{idx + 1}</span>
                                                            <div>
                                                                <div className="font-bold text-navy">{player.name}</div>
                                                                <div className="text-[10px] text-gray-500 uppercase">
                                                                    {player.team} {leaderMode === 'career' && `• ${player.matches} Mtch`}
                                                                    {leaderMode === 'career' && player.balls && ` • ${player.balls} Balls`}
                                                                </div>
                                                                {leaderMode === 'career' && player.orangeCaps && (
                                                                    <div className="flex items-center gap-1 text-[8px] font-black text-amber-600 uppercase">
                                                                        <Award size={10} /> {player.orangeCaps} Orange Caps
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="text-right">
                                                            <div className="text-2xl font-black text-navy">{player.runs}</div>
                                                            <div className="text-[10px] text-gray-400 uppercase">Runs</div>
                                                        </div>
                                                    </div>
                                                ))}
                                                {playerStats.filter(p => p.runs > 0).length === 0 && (
                                                    <div className="text-center text-gray-400 py-10 uppercase font-bold text-xs">No batting data recorded</div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="pro-card p-6">
                                            <h4 className="text-xl font-bold text-navy mb-6 flex items-center gap-2">
                                                <Award className="text-purple-600" /> {leaderMode === 'career' ? 'All-Time Wickets' : 'Purple Cap (Top Bowlers)'}
                                            </h4>
                                            <div className="space-y-4">
                                                {[...playerStats].sort((a,b) => b.wickets - a.wickets).filter(p => p.wickets > 0).slice(0, 10).map((player, idx) => (
                                                    <div key={idx} className="flex justify-between items-center p-3 bg-gray-50 rounded border hover:border-purple-400 transition-colors">
                                                        <div className="flex items-center gap-4">
                                                            <span className="text-xl font-black text-gray-200 w-6">#{idx + 1}</span>
                                                            <div>
                                                                <div className="font-bold text-navy">{player.name}</div>
                                                                <div className="text-[10px] text-gray-500 uppercase">
                                                                    {player.team} {leaderMode === 'career' && `• ${player.matches} Mtch`}
                                                                </div>
                                                                {leaderMode === 'career' && player.purpleCaps && (
                                                                    <div className="flex items-center gap-1 text-[8px] font-black text-purple-600 uppercase">
                                                                        <Award size={10} /> {player.purpleCaps} Purple Caps
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="text-right">
                                                            <div className="text-2xl font-black text-navy">{player.wickets}</div>
                                                            <div className="text-[10px] text-gray-400 uppercase">Wickets</div>
                                                        </div>
                                                    </div>
                                                ))}
                                                {[...playerStats].sort((a,b) => b.wickets - a.wickets).filter(p => p.wickets > 0).length === 0 && (
                                                    <div className="text-center text-gray-400 py-10 uppercase font-bold text-xs">No bowling data recorded</div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </section>
                            )}

                            {activeTab === 'playoffs' && (
                                <section id="playoffs">
                                    {!isLeagueComplete ? (
                                        <div className="bg-white p-12 text-center rounded border shadow-sm">
                                            <Users size={64} className="mx-auto text-gray-300 mb-4" />
                                            <h3 className="text-xl font-bold text-gray-400 text-uppercase tracking-widest">League Stage Ongoing</h3>
                                            <p className="text-gray-400">Complete all qualifying matches to unlock playoffs.</p>
                                        </div>
                                    ) : (
                                        <div className="animate-up">
                                            <div className="mb-12">
                                                <h4 className="text-center mb-8 text-gray-500 font-bold uppercase text-xs tracking-[0.2em]">Playoff Stages</h4>
                                                <div className="grid md:grid-cols-2 gap-8 justify-items-center">
                                                    {semiMatches.map((m, idx) => (
                                                        <div key={m.id} className="w-full max-w-md">
                                                            <div className="text-center mb-4">
                                                                <span className="bg-navy text-white text-[10px] px-3 py-1 rounded-full font-bold uppercase tracking-widest">
                                                                    {idx === 0 ? "Qualifier 1 (Rank 1 vs 2)" : "Qualifier 2 (Q1 Loser vs Rank 3)"}
                                                                </span>
                                                            </div>
                                                            <MatchCard match={m} onEdit={() => setEditingMatch(m)} />
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            {finalMatch && (
                                                <div className="text-center pb-12">
                                                    <Crown size={48} className="text-amber-400 mx-auto mb-3" />
                                                    <h2 className="text-3xl font-extrabold text-navy mb-8">THE GRAND FINAL</h2>
                                                    <div className="flex justify-center">
                                                        <div className="w-full max-w-md">
                                                            <MatchCard match={finalMatch} onEdit={() => setEditingMatch(finalMatch)} />
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </section>
                            )}
                        </div>
                    </div>
                )}
            </main>

            {/* Modals */}
            <AnimatePresence>
                {showPlayerManager && (
                    <PlayerManager 
                        players={userPlayers} 
                        onClose={() => setShowPlayerManager(false)}
                    />
                )}
                {editingMatch && (
                    <MatchResultModal 
                        match={editingMatch} 
                        teams={state.teams}
                        onClose={() => setEditingMatch(null)} 
                        onSave={handleUpdateResult}
                    />
                )}
                {state.playoffs.champion && (
                    <ChampionOverlay 
                        teamName={state.playoffs.champion} 
                        onClose={() => setState(prev => ({ ...prev, playoffs: { champion: null } }))} 
                    />
                )}
            </AnimatePresence>
        </div>
    );
};

const LandingPage: React.FC<{ 
    cloudTournaments: TournamentState[]; 
    onSelectMode: (mode: AppMode) => void;
    onViewTournament: (t: TournamentState) => void;
    user: User | null;
    onManagePlayers: () => void;
    onClearLocal: (e: React.MouseEvent) => void;
}> = ({ cloudTournaments, onSelectMode, onViewTournament, user, onManagePlayers, onClearLocal }) => {
    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-6xl mx-auto space-y-12">
            <div className="text-center py-12">
                <h1 className="text-navy text-6xl md:text-8xl font-black italic tracking-tighter leading-tight mb-4">CRICKET HUB</h1>
                <div className="h-2 w-48 bg-amber-400 mx-auto mb-6 rounded-full"></div>
                <p className="text-gray-500 font-bold uppercase tracking-widest">Global Tournament Management Protocol</p>
                
                {user && (
                    <motion.button 
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={onManagePlayers}
                        className="mt-8 mx-auto flex items-center gap-2 bg-white text-navy border-2 border-navy px-6 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.2em] shadow-lg hover:bg-navy hover:text-white transition-all"
                    >
                        <Users size={14} /> Manage My Roster
                    </motion.button>
                )}
            </div>

            <div className="grid md:grid-cols-2 gap-8">
                {/* QUICK RESUME - ONLY SHOWS IF LOCAL DATA EXISTS */}
                {localStorage.getItem(STORAGE_KEY) && (
                    <div className="md:col-span-2 relative group">
                        <motion.div 
                            whileHover={{ y: -5 }}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            onClick={() => onSelectMode('timepass')}
                            className="bg-white border-4 border-amber-400 p-8 rounded-[3rem] shadow-2xl overflow-hidden cursor-pointer flex flex-col md:flex-row justify-between items-center gap-6"
                        >
                            <div className="flex items-center gap-6">
                                <div className="p-5 bg-amber-100 rounded-3xl text-amber-600">
                                    <Clock size={42} strokeWidth={2.5} />
                                </div>
                                <div>
                                    <div className="text-[10px] font-black text-amber-500 uppercase tracking-[0.3em] mb-1">Active Local Tournament</div>
                                    <h3 className="text-4xl font-black text-navy uppercase italic tracking-tighter">{JSON.parse(localStorage.getItem(STORAGE_KEY)!).name}</h3>
                                    <p className="text-gray-400 text-[10px] font-bold uppercase mt-1">Ready to resume • stored on this device</p>
                                </div>
                            </div>
                            <button 
                                onClick={() => onSelectMode('timepass')}
                                className="bg-navy text-white px-10 py-4 rounded-2xl font-black uppercase tracking-widest hover:bg-black transition-all shadow-xl whitespace-nowrap"
                            >
                                CONTINUE MATCHES
                            </button>
                        </motion.div>
                        <button 
                            onClick={onClearLocal}
                            className="absolute -top-4 -right-4 p-3 bg-red-500 text-white rounded-full shadow-2xl opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 active:scale-95 border-4 border-white"
                            title="Wipe Local Data"
                        >
                            <Trash2 size={20} />
                        </button>
                    </div>
                )}

                {/* PRO MODE */}
                <motion.div whileHover={{ y: -5 }} className="bg-navy p-8 rounded-[3rem] text-white shadow-2xl relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform">
                        <Globe size={120} />
                    </div>
                    <div className="relative z-10 space-y-6">
                        <div className="bg-white/10 w-fit p-4 rounded-2xl">
                            <Plus size={32} className="text-amber-400" />
                        </div>
                        <h2 className="text-4xl font-black italic tracking-tighter">PRO SERIES</h2>
                        <ul className="space-y-3 opacity-70 text-[10px] font-black uppercase tracking-widest">
                            <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-amber-400 rounded-full"></div> CLOUD DATABASE PERSISTENCE</li>
                            <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-amber-400 rounded-full"></div> PUBLIC TOURNAMENT GALLERY</li>
                            <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-amber-400 rounded-full"></div> GLOBAL PLAYER CAREERS</li>
                        </ul>
                        <button 
                            onClick={() => onSelectMode('cloud')}
                            className="w-full bg-white text-navy py-5 rounded-[2rem] font-black uppercase tracking-widest hover:bg-amber-400 transition-colors shadow-xl"
                        >
                            {user ? "START NEW PRO SERIES" : "SIGN IN & CREATE"}
                        </button>
                    </div>
                </motion.div>

                {/* TIMEPASS MODE */}
                <motion.div whileHover={{ y: -5 }} className="bg-white p-8 rounded-[3rem] border-4 border-navy shadow-2xl relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:scale-110 transition-transform">
                        <Clock size={120} />
                    </div>
                    <div className="relative z-10 space-y-6">
                        <div className="bg-navy/5 w-fit p-4 rounded-2xl">
                            <Play size={32} className="text-navy" />
                        </div>
                        <h2 className="text-4xl font-black italic tracking-tighter text-navy uppercase">LOCAL QUICKIE</h2>
                        <ul className="space-y-3 text-gray-400 text-[10px] font-black uppercase tracking-widest">
                            <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-navy rounded-full"></div> INSTANT LOCAL STORAGE</li>
                            <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-navy rounded-full"></div> NO SESSION LIMITS</li>
                            <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-navy rounded-full"></div> OFFLINE COMPATIBLE</li>
                        </ul>
                        <button 
                            onClick={() => onSelectMode('timepass')}
                            className="w-full bg-navy text-white py-5 rounded-[2rem] font-black uppercase tracking-widest hover:bg-black transition-colors shadow-xl"
                        >
                            START LOCAL LEAGUE
                        </button>
                    </div>
                </motion.div>
            </div>

            {/* LIVE GALLERY */}
            <section className="space-y-8 pt-12">
                <div className="flex items-center gap-4 justify-center md:justify-start">
                    <h3 className="text-2xl font-black italic tracking-tighter text-navy uppercase">GLOBAL BROADCAST GALLERY</h3>
                    <div className="h-px flex-1 bg-gray-200 hidden md:block"></div>
                </div>

                {cloudTournaments.length === 0 ? (
                    <div className="bg-white p-20 text-center rounded-[3rem] border-4 border-dashed">
                        <Globe size={48} className="mx-auto text-gray-200 mb-4 animate-spin-slow" />
                        <p className="text-gray-400 font-bold uppercase tracking-widest">No active global tournaments found</p>
                    </div>
                ) : (
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {cloudTournaments.map(t => (
                            <motion.div 
                                key={t.id}
                                whileHover={{ scale: 1.02 }}
                                onClick={() => onViewTournament(t)}
                                className="bg-white p-6 rounded-[2rem] border shadow-sm cursor-pointer hover:shadow-xl transition-all border-b-8 border-b-navy"
                            >
                                <div className="flex justify-between items-start mb-4">
                                    <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest">LIVE</span>
                                    <span className="text-[8px] text-gray-400 font-bold uppercase">{new Date(t.createdAt || 0).toLocaleDateString()}</span>
                                </div>
                                <h4 className="text-xl font-black italic tracking-tight text-navy uppercase truncate mb-4">{t.name}</h4>
                                <div className="flex justify-between items-center pt-4 border-t border-dashed">
                                    <div className="flex items-center gap-2">
                                        <Users size={12} className="text-gray-400" />
                                        <span className="text-[10px] font-bold text-gray-600">{t.teamCount} FRANCHISES</span>
                                    </div>
                                    <span className="text-[10px] font-black text-blue-700 uppercase">VIEW BOARD ➔</span>
                                </div>
                                <div className="mt-4 text-[8px] text-gray-400 font-bold uppercase truncate">BY: {t.creatorEmail}</div>
                            </motion.div>
                        ))}
                    </div>
                )}
            </section>
        </motion.div>
    );
};
const TeamInput: React.FC<{ 
    index: number; 
    data: { name: string; players: string[] }; 
    roster: RosterPlayer[]; 
    onChange: (val: { name: string; players: string[] }) => void;
    openRoster: () => void;
}> = ({ index, data, roster, onChange, openRoster }) => {
    return (
        <motion.div 
            initial={{ opacity: 0, y: 10 }} 
            animate={{ opacity: 1, y: 0 }} 
            transition={{ delay: index * 0.05 }}
            className="p-6 bg-white rounded-3xl border shadow-sm hover:shadow-md transition-shadow relative"
        >
            <div className="absolute -top-3 -left-3 w-8 h-8 bg-navy text-white rounded-full flex items-center justify-center font-black text-xs italic shadow-lg">
                {index + 1}
            </div>
            
            <div className="space-y-4">
                <div>
                    <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1 mb-1.5 block">TEAM FRANCHISE NAME</label>
                    <input 
                        value={data.name} 
                        onChange={(e) => onChange({ ...data, name: e.target.value })}
                        placeholder="e.g. Mumbai Strikers"
                        className="w-full px-4 py-3 bg-gray-50 border-2 rounded-xl focus:border-navy outline-none font-bold text-navy"
                    />
                </div>

                <div className="space-y-3">
                    <div className="flex justify-between items-center">
                        <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest">SQUAD SELECTION</label>
                        <button 
                            type="button" 
                            onClick={openRoster}
                            className="text-[9px] text-blue-600 font-black uppercase hover:underline flex items-center gap-1"
                        >
                            <Plus size={10} /> ADD PLAYERS TO MY ROSTER
                        </button>
                    </div>

                    <div className="flex flex-wrap gap-1.5 p-3 bg-gray-50/50 border border-dashed rounded-2xl max-h-40 overflow-y-auto custom-scrollbar">
                        {roster.length === 0 ? (
                            <div className="w-full text-center py-4 bg-white/50 rounded-xl">
                                <p className="text-[8px] text-gray-400 font-bold uppercase">No players in your professional roster</p>
                            </div>
                        ) : (
                            roster.map(player => {
                                const isSelected = data.players.includes(player.name);
                                return (
                                    <button
                                        key={player.id}
                                        type="button"
                                        onClick={() => {
                                            if (isSelected) {
                                                onChange({ ...data, players: data.players.filter(p => p !== player.name) });
                                            } else {
                                                onChange({ ...data, players: [...data.players, player.name] });
                                            }
                                        }}
                                        className={`text-[9px] font-black px-3 py-2 rounded-lg transition-all border ${isSelected ? 'bg-amber-400 text-navy border-amber-400 shadow-sm' : 'bg-white text-gray-400 border-gray-100 hover:border-navy'}`}
                                    >
                                        {player.name}
                                    </button>
                                );
                            })
                        )}
                    </div>

                    <div className="relative">
                        <textarea 
                            className="w-full p-4 bg-white border-2 rounded-2xl text-xs outline-none focus:border-navy font-medium italic text-gray-500"
                            placeholder="Add occasional players (comma separated)..."
                            rows={2}
                            value={data.players.join(", ")}
                            onChange={(e) => {
                                const names = e.target.value.split(",").map(p => p.trim()).filter(p => p !== "");
                                onChange({ ...data, players: names });
                            }}
                        />
                        <div className="absolute bottom-3 right-3 text-[8px] font-bold text-gray-300 uppercase">
                            {data.players.length} PLAYERS
                        </div>
                    </div>
                </div>
            </div>
        </motion.div>
    );
};

const SetupForm: React.FC<{ 
    onLaunch: (name: string, teams: { name: string; players: string[] }[]) => void,
    isLaunching: boolean,
    roster: RosterPlayer[],
    openRoster: () => void
}> = ({ onLaunch, isLaunching, roster, openRoster }) => {
    const [name, setName] = useState("");
    const [count, setCount] = useState("");
    const [teamData, setTeamData] = useState<{ name: string; players: string[] }[]>([]);

    useEffect(() => {
        const n = parseInt(count);
        if (!isNaN(n)) {
            setTeamData(prev => {
                return Array(n).fill(null).map((_, i) => ({
                    name: prev[i]?.name || "",
                    players: prev[i]?.players || []
                }));
            });
        } else {
            setTeamData([]);
        }
    }, [count]);

    return (
        <div className="max-w-4xl mx-auto">
            <div className="text-center mb-12">
                <h1 className="text-navy text-4xl md:text-5xl font-black italic tracking-tighter uppercase mb-2">Initialize Series</h1>
                <p className="text-gray-400 text-[10px] font-black uppercase tracking-[0.3em]">Configure your custom tournament protocol</p>
                <div className="h-1.5 w-24 bg-amber-400 mx-auto mt-4 rounded-full"></div>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); onLaunch(name, teamData); }} className="space-y-12">
                <div className="grid md:grid-cols-2 gap-8">
                    <div className="bg-white p-8 rounded-3xl border shadow-sm space-y-6">
                        <div>
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1.5">TOURNAMENT TITLE</label>
                            <input 
                                value={name} 
                                onChange={(e) => setName(e.target.value)} 
                                required 
                                type="text" 
                                className="w-full px-5 py-4 border-2 rounded-2xl focus:border-navy outline-none font-black text-navy text-xl italic" 
                                placeholder="THE CHAMPIONS TROPHY" 
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-4">NUM OF TEAMS</label>
                            <div className="grid grid-cols-4 gap-2">
                                {[2, 3, 4, 5, 8, 10].map(n => (
                                    <button
                                        key={n}
                                        type="button"
                                        onClick={() => setCount(n.toString())}
                                        className={`py-3 rounded-xl border-2 font-black text-xs transition-all ${count === n.toString() ? 'bg-navy text-white border-navy shadow-lg scale-105' : 'bg-gray-50 text-gray-400 border-gray-100 hover:border-navy'}`}
                                    >
                                        {n}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="bg-navy p-8 rounded-3xl text-white shadow-2xl flex flex-col justify-center">
                        <div className="flex items-center gap-4 mb-6">
                            <div className="bg-white/10 p-4 rounded-2xl">
                                <Trophy className="text-amber-400" size={32} />
                            </div>
                            <div>
                                <h3 className="text-2xl font-black italic tracking-tight uppercase">PROTOCOL PREVIEW</h3>
                                <p className="text-[10px] uppercase opacity-60 font-bold">Automatic fixture validation enabled</p>
                            </div>
                        </div>
                        <p className="text-xs opacity-80 leading-relaxed font-bold uppercase tracking-widest mb-6">
                            Once launched, the system will generate a full Round-Robin league stage followed by Qualifiers, Semi-Finals, and a Grand Final.
                        </p>
                        <ul className="grid grid-cols-2 gap-4">
                            <li className="bg-white/5 p-3 rounded-xl border border-white/10 text-center">
                                <div className="text-[8px] opacity-60 mb-1">TOTAL TEAMS</div>
                                <div className="text-xl font-black italic">{count || "0"}</div>
                            </li>
                            <li className="bg-white/5 p-3 rounded-xl border border-white/10 text-center">
                                <div className="text-[8px] opacity-60 mb-1">STAGES</div>
                                <div className="text-xl font-black italic">LEAGUE + K.O</div>
                            </li>
                        </ul>
                    </div>
                </div>

                {teamData.length > 0 && (
                    <motion.div 
                        initial={{ opacity: 0 }} 
                        animate={{ opacity: 1 }} 
                        className="grid md:grid-cols-2 gap-6"
                    >
                        {teamData.map((team, i) => (
                            <TeamInput 
                                key={i} 
                                index={i} 
                                data={team} 
                                roster={roster} 
                                openRoster={openRoster}
                                onChange={(val) => {
                                    const next = [...teamData];
                                    next[i] = val;
                                    setTeamData(next);
                                }} 
                            />
                        ))}
                    </motion.div>
                )}

                <div className="flex justify-center pt-8">
                    <button 
                        type="submit" 
                        disabled={isLaunching || teamData.length === 0}
                        className="w-full max-w-xl group bg-navy text-white py-6 rounded-[2.5rem] font-black uppercase tracking-[0.4em] shadow-2xl hover:bg-black transition-all transform hover:scale-[1.02] disabled:bg-gray-400 disabled:scale-100 flex items-center justify-center gap-4 text-xl"
                    >
                        {isLaunching ? (
                            <>
                                <div className="w-6 h-6 border-4 border-white/20 border-t-amber-400 rounded-full animate-spin"></div>
                                BOOTING...
                            </>
                        ) : (
                            <>
                                <Play size={24} className="group-hover:text-amber-400 transition-colors" /> LAUNCH SERIES
                            </>
                        )}
                    </button>
                </div>
            </form>
        </div>
    );
};

const MatchCard: React.FC<{ match: Match; onEdit: () => void }> = ({ match, onEdit }) => {
    const isCompleted = match.status === 'completed';
    return (
        <div className={`pro-card p-6 match-card relative overflow-hidden border-l-4 ${isCompleted ? 'border-l-gray-300' : 'border-l-blue-800'}`}>
            <span className={`status-badge ${isCompleted ? 'status-completed' : 'status-upcoming'}`}>
                {isCompleted ? 'Result Final' : 'Match Scheduled'}
            </span>
            <div className="text-[10px] font-bold text-gray-400 uppercase mb-5 tracking-widest">
                Match #{match.id} • {match.type.replace('-', ' ')}
            </div>
            
            <div className="flex items-center justify-between gap-2 mb-6">
                <div className="flex-1 text-center">
                    <div className="team-logo-placeholder mx-auto mb-2">{match.team1.substring(0, 3)}</div>
                    <div className="text-[10px] font-bold text-navy uppercase truncate">{match.team1}</div>
                    <div className="score-num mt-2">{isCompleted ? `${match.team1Score}/${match.team1Wickets}` : '-'}</div>
                </div>
                <div className="text-[10px] font-bold text-gray-300">VS</div>
                <div className="flex-1 text-center">
                    <div className="team-logo-placeholder mx-auto mb-2">{match.team2.substring(0, 3)}</div>
                    <div className="text-[10px] font-bold text-navy uppercase truncate">{match.team2}</div>
                    <div className="score-num mt-2">{isCompleted ? `${match.team2Score}/${match.team2Wickets}` : '-'}</div>
                </div>
            </div>

            <div className="flex justify-between items-center pt-4 border-t">
                <div className="flex items-center gap-1">
                    {isCompleted ? (
                        <>
                            <CheckCircle size={12} className="text-green-600" />
                            <span className="text-navy font-bold text-[10px] uppercase">{match.winner === 'Tie' ? 'Match Tied' : `${match.winner} Won`}</span>
                        </>
                    ) : (
                        <span className="text-gray-400 font-bold text-[10px] uppercase">Fixture Pending</span>
                    )}
                </div>
                <button onClick={onEdit} className="bg-blue-800 hover:bg-blue-900 text-white text-[10px] py-1 px-3 font-bold rounded">
                    {isCompleted ? 'EDIT' : 'ENTER RESULT'}
                </button>
            </div>
        </div>
    );
};

const StatCard: React.FC<{ label: string; value: string | number; color?: string; isGold?: boolean }> = ({ label, value, color, isGold }) => (
    <div className={`stat-pill h-full ${isGold ? 'border-b-4 border-b-amber-400' : ''}`}>
        <span className="stat-label">{label}</span>
        <span className="stat-value" style={{ color: color || 'var(--bcci-navy)' }}>{value}</span>
    </div>
);

const TabButton: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
    <button onClick={onClick} className={`px-5 py-2.5 rounded font-bold uppercase text-[11px] tracking-wider transition-all ${active ? 'bg-navy text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
        {children}
    </button>
);

const ScoringButtons: React.FC<{ 
    teamName: string, 
    onAddRuns: (n: number) => void, 
    onAddWicket: () => void,
    onAddOvers: (n: number) => void
}> = ({ teamName, onAddRuns, onAddWicket, onAddOvers }) => (
    <div className="space-y-4">
        <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest block text-left">QUICK SCOREPAD: {teamName}</label>
        <div className="flex flex-wrap gap-2">
            {[1, 4, 6].map(n => (
                <button key={n} type="button" onClick={() => onAddRuns(n)} className="bg-gray-100 hover:bg-navy hover:text-white px-3 py-2 rounded-xl font-black transition-all flex items-center gap-1">
                    <Plus size={12} /> {n}
                </button>
            ))}
            <button type="button" onClick={onAddWicket} className="bg-red-50 text-red-600 hover:bg-red-600 hover:text-white px-3 py-2 rounded-xl font-black transition-all border border-red-100 flex items-center gap-1">
                WKT
            </button>
            <button type="button" onClick={() => onAddOvers(0.1)} className="bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white px-3 py-2 rounded-xl font-black transition-all border border-blue-100 flex items-center gap-1">
                +0.1 OV
            </button>
            <button type="button" onClick={() => onAddOvers(1.0)} className="bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white px-3 py-2 rounded-xl font-black transition-all border border-blue-100 flex items-center gap-1">
                +1.0 OV
            </button>
        </div>
    </div>
);

const MatchResultModal: React.FC<{ 
    match: Match; 
    onClose: () => void; 
    onSave: (id: number, results: Partial<Match>) => void;
    teams: Team[];
}> = ({ match, onClose, onSave, teams }) => {
    // TESTING EDIT
    const t1 = teams.find(t => t.name === match.team1);
    const t2 = teams.find(t => t.name === match.team2);

    const [data, setData] = useState({
        team1Score: match.team1Score || 0,
        team1Wickets: match.team1Wickets || 0,
        team2Score: match.team2Score || 0,
        team2Wickets: match.team2Wickets || 0,
        team1Overs: match.team1Overs || 0,
        team2Overs: match.team2Overs || 0,
        quota: match.quota || 20,
        playerPerformances: match.playerPerformances || {
            team1Players: (t1?.players || []).map(p => ({ playerName: p, runs: 0, wickets: 0, balls: 0 })),
            team2Players: (t2?.players || []).map(p => ({ playerName: p, runs: 0, wickets: 0, balls: 0 }))
        }
    });

    const [newPlayer, setNewPlayer] = useState({ name: "", team: 1 });
    const [showPlayers, setShowPlayers] = useState(false);

    const handleAddRuns = (team: 1 | 2, n: number) => {
        if (team === 1) setData(d => ({ ...d, team1Score: d.team1Score + n }));
        else setData(d => ({ ...d, team2Score: d.team2Score + n }));
    };

    const handleAddWicket = (team: 1 | 2) => {
        if (team === 1 && data.team1Wickets < 10) setData(d => ({ ...d, team1Wickets: d.team1Wickets + 1 }));
        if (team === 2 && data.team2Wickets < 10) setData(d => ({ ...d, team2Wickets: d.team2Wickets + 1 }));
    };

    const handleAddOvers = (team: 1 | 2, n: number) => {
        setData(d => {
            let current = team === 1 ? d.team1Overs : d.team2Overs;
            let full = Math.floor(current);
            let balls = Math.round((current - full) * 10);
            
            if (n === 0.1) {
                balls += 1;
                if (balls >= 6) { full += 1; balls = 0; }
            } else {
                full += n;
            }
            
            const next = parseFloat((full + balls / 10).toFixed(1));
            return team === 1 ? { ...d, team1Overs: next } : { ...d, team2Overs: next };
        });
    };

    // Auto-adjust overs if all-out
    useEffect(() => {
        if (data.team1Wickets === 10) setData(d => ({ ...d, team1Overs: d.quota }));
        if (data.team2Wickets === 10) setData(d => ({ ...d, team2Overs: d.quota }));
    }, [data.team1Wickets, data.team2Wickets, data.quota]);

    const addPlayer = () => {
        if (!newPlayer.name.trim()) return;
        const next = { ...data.playerPerformances };
        if (newPlayer.team === 1) {
            next.team1Players.push({ playerName: newPlayer.name.trim(), runs: 0, wickets: 0, balls: 0 });
        } else {
            next.team2Players.push({ playerName: newPlayer.name.trim(), runs: 0, wickets: 0, balls: 0 });
        }
        setData({ ...data, playerPerformances: next });
        setNewPlayer({ name: "", team: 1 });
    };

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }} className="bg-white rounded-lg w-full max-w-2xl my-8 overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
                <div className="bg-navy p-6 text-white flex justify-between items-center flex-shrink-0">
                    <div>
                        <h3 className="text-xl font-bold uppercase flex items-center gap-2">Match # {match.id} Result</h3>
                        <p className="text-[10px] opacity-70 uppercase tracking-widest">{match.type}</p>
                    </div>
                    <button onClick={onClose} className="hover:rotate-90 transition-transform"><X /></button>
                </div>
                
                <form onSubmit={(e) => { e.preventDefault(); onSave(match.id, data); }} className="p-8 space-y-6 overflow-y-auto">
                    <div className="grid grid-cols-2 gap-8">
                        {/* Team 1 */}
                        <div className="space-y-4">
                            <h4 className="font-bold text-navy uppercase text-sm border-b-2 border-blue-800 pb-2">{match.team1}</h4>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Runs</label>
                                    <input type="number" required value={data.team1Score} onChange={e => setData({...data, team1Score: +e.target.value})} className="w-full p-2 border rounded font-bold focus:border-blue-700 outline-none" />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Wickets</label>
                                    <input type="number" required max={10} value={data.team1Wickets} onChange={e => setData({...data, team1Wickets: +e.target.value})} className="w-full p-2 border rounded font-bold focus:border-blue-700 outline-none" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Overs Faced {data.team1Wickets === 10 && <span className="text-red-500">(Locked - All Out)</span>}</label>
                                <input type="number" step="0.1" disabled={data.team1Wickets === 10} required value={data.team1Overs} onChange={e => setData({...data, team1Overs: +e.target.value})} className="w-full p-2 border rounded font-bold bg-white disabled:bg-gray-50 focus:border-blue-700 outline-none" />
                            </div>
                        </div>
                        {/* Team 2 */}
                        <div className="space-y-4">
                            <h4 className="font-bold text-navy uppercase text-sm border-b-2 border-amber-500 pb-2">{match.team2}</h4>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Runs</label>
                                    <input type="number" required value={data.team2Score} onChange={e => setData({...data, team2Score: +e.target.value})} className="w-full p-2 border rounded font-bold focus:border-blue-700 outline-none" />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Wickets</label>
                                    <input type="number" required max={10} value={data.team2Wickets} onChange={e => setData({...data, team2Wickets: +e.target.value})} className="w-full p-2 border rounded font-bold focus:border-blue-700 outline-none" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Overs Faced {data.team2Wickets === 10 && <span className="text-red-500">(Locked - All Out)</span>}</label>
                                <input type="number" step="0.1" disabled={data.team2Wickets === 10} required value={data.team2Overs} onChange={e => setData({...data, team2Overs: +e.target.value})} className="w-full p-2 border rounded font-bold bg-white disabled:bg-gray-50 focus:border-blue-700 outline-none" />
                            </div>
                        </div>
                    </div>

                    <div className="border-t pt-6">
                        <div className="flex justify-between items-center mb-4">
                            <button 
                                type="button" 
                                onClick={() => setShowPlayers(!showPlayers)}
                                className="text-blue-700 font-bold text-xs uppercase flex items-center gap-2 hover:underline"
                            >
                                {showPlayers ? 'Hide Player Stats' : 'Enter Individual Contributions (Optional)'}
                            </button>
                            {showPlayers && (
                                <div className="flex gap-2">
                                    <input 
                                        type="text" 
                                        placeholder="Add Player Name..." 
                                        className="text-xs p-1 border rounded"
                                        value={newPlayer.name}
                                        onChange={e => setNewPlayer({...newPlayer, name: e.target.value})}
                                    />
                                    <select 
                                        className="text-xs p-1 border rounded"
                                        value={newPlayer.team}
                                        onChange={e => setNewPlayer({...newPlayer, team: +e.target.value})}
                                    >
                                        <option value={1}>{match.team1}</option>
                                        <option value={2}>{match.team2}</option>
                                    </select>
                                    <button type="button" onClick={addPlayer} className="bg-navy text-white text-[10px] px-2 rounded">ADD</button>
                                </div>
                            )}
                        </div>

                        {showPlayers && (
                            <div className="grid grid-cols-2 gap-8 p-1">
                                <div className="space-y-3">
                                    <span className="text-[10px] font-bold text-navy uppercase flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-blue-800"></div> {match.team1} PERFORMANCES
                                    </span>
                                    <div className="max-h-48 overflow-y-auto space-y-2 pr-2">
                                        {data.playerPerformances.team1Players.map((p, idx) => (
                                            <div key={idx} className="flex gap-2 items-center bg-gray-50 p-2 rounded">
                                                <span className="text-[10px] font-bold flex-1 truncate">{p.playerName}</span>
                                                <div className="flex gap-1 shrink-0">
                                                    <input type="number" placeholder="R" title="Runs" className="w-10 p-1 text-[10px] border rounded" value={p.runs} onChange={(e) => {
                                                        const next = {...data.playerPerformances};
                                                        next.team1Players[idx].runs = +e.target.value;
                                                        setData({...data, playerPerformances: next});
                                                    }} />
                                                    <input type="number" placeholder="B" title="Balls" className="w-10 p-1 text-[10px] border rounded" value={p.balls || 0} onChange={(e) => {
                                                        const next = {...data.playerPerformances};
                                                        next.team1Players[idx].balls = +e.target.value;
                                                        setData({...data, playerPerformances: next});
                                                    }} />
                                                    <input type="number" placeholder="W" title="Wickets" className="w-10 p-1 text-[10px] border rounded" value={p.wickets} onChange={(e) => {
                                                        const next = {...data.playerPerformances};
                                                        next.team1Players[idx].wickets = +e.target.value;
                                                        setData({...data, playerPerformances: next});
                                                    }} />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="space-y-3">
                                    <span className="text-[10px] font-bold text-navy uppercase flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-amber-500"></div> {match.team2} PERFORMANCES
                                    </span>
                                    <div className="max-h-48 overflow-y-auto space-y-2 pr-2">
                                        {data.playerPerformances.team2Players.map((p, idx) => (
                                            <div key={idx} className="flex gap-2 items-center bg-gray-50 p-2 rounded">
                                                <span className="text-[10px] font-bold flex-1 truncate">{p.playerName}</span>
                                                <div className="flex gap-1 shrink-0">
                                                    <input type="number" placeholder="R" title="Runs" className="w-10 p-1 text-[10px] border rounded" value={p.runs} onChange={(e) => {
                                                        const next = {...data.playerPerformances};
                                                        next.team2Players[idx].runs = +e.target.value;
                                                        setData({...data, playerPerformances: next});
                                                    }} />
                                                    <input type="number" placeholder="B" title="Balls" className="w-10 p-1 text-[10px] border rounded" value={p.balls || 0} onChange={(e) => {
                                                        const next = {...data.playerPerformances};
                                                        next.team2Players[idx].balls = +e.target.value;
                                                        setData({...data, playerPerformances: next});
                                                    }} />
                                                    <input type="number" placeholder="W" title="Wickets" className="w-10 p-1 text-[10px] border rounded" value={p.wickets} onChange={(e) => {
                                                        const next = {...data.playerPerformances};
                                                        next.team2Players[idx].wickets = +e.target.value;
                                                        setData({...data, playerPerformances: next});
                                                    }} />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </form>

                <div className="p-6 border-t bg-gray-50 flex items-center justify-between flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <label className="block text-[10px] font-bold text-gray-500 uppercase">Match Quota (Overs):</label>
                        <input type="number" value={data.quota} onChange={e => setData({...data, quota: +e.target.value})} className="w-16 p-1 border rounded font-bold text-center" />
                    </div>
                    <button 
                        type="button" 
                        onClick={() => onSave(match.id, data)}
                        className="bg-blue-800 text-white font-bold py-3 px-10 rounded shadow-lg hover:bg-blue-900 transition-all uppercase text-sm tracking-widest"
                    >
                        Save Series Data
                    </button>
                </div>
            </motion.div>
        </motion.div>
    );
};

const ChampionOverlay: React.FC<{ teamName: string; onClose: () => void }> = ({ teamName, onClose }) => (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="overlay">
        <div className="text-center">
            <motion.div animate={{ rotate: [0, 10, -10, 0], scale: [1, 1.1, 1] }} transition={{ repeat: Infinity, duration: 2 }}>
                <img src="https://img.icons8.com/color/120/tournament.png" className="winner-trophy mx-auto mb-4" alt="Trophy" />
            </motion.div>
            <h1 className="text-6xl font-black mb-2 tracking-tighter">CHAMPIONS!</h1>
            <h1 className="text-8xl font-black glow-text text-amber-400 mb-8 uppercase px-4">{teamName}</h1>
            <button onClick={onClose} className="border-2 border-amber-400 text-amber-400 font-bold py-3 px-10 rounded-full hover:bg-amber-400 hover:text-navy transition-all uppercase tracking-widest">
                View Standings
            </button>
        </div>
    </motion.div>
);

export default App;

const PlayerManager: React.FC<{ players: RosterPlayer[], onClose: () => void }> = ({ players, onClose }) => {
    const [name, setName] = useState("");
    const [isSaving, setIsSaving] = useState(false);

    const addPlayer = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedName = name.trim();
        if (!trimmedName) return alert("Please enter a player name");
        
        setIsSaving(true);
        console.log("Attempting to add player to roster:", trimmedName);
        
        try {
            const playerPayload = {
                name: trimmedName,
                creatorId: auth.currentUser?.uid,
                createdAt: Date.now()
            };
            console.log("DEBUG: Attempting to add player with payload:", JSON.stringify(playerPayload));
            const docRef = await addDoc(collection(db, "players"), playerPayload);
            console.log("Player added to roster successfully. ID:", docRef.id);
            setName("");
        } catch (error) {
            console.error("Add player error:", error);
            handleFirestoreError(error, OperationType.WRITE, "players");
        } finally {
            setIsSaving(false);
        }
    };

    const deletePlayer = async (id: string) => {
        if (!confirm("Remove this player from roster?")) return;
        try {
            await deleteDoc(doc(db, "players", id));
        } catch (error) {
            handleFirestoreError(error, OperationType.DELETE, `players/${id}`);
        }
    };

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }} className="bg-white rounded-3xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
                <div className="bg-navy p-8 text-white flex justify-between items-center">
                    <div>
                        <h3 className="text-2xl font-black italic tracking-tighter uppercase">My Professional Roster</h3>
                        <p className="text-[10px] opacity-60 font-bold uppercase tracking-[0.2em]">Manage your permanent player database</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors"><X /></button>
                </div>

                <div className="p-8 flex flex-col gap-8 overflow-hidden">
                    <form onSubmit={addPlayer} className="flex gap-2">
                        <input 
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Full Player Name..."
                            className="flex-1 px-4 py-3 border-2 rounded-xl focus:border-navy outline-none font-bold"
                        />
                        <button 
                            type="submit"
                            disabled={isSaving}
                            className="bg-navy text-white px-6 rounded-xl font-black uppercase tracking-widest hover:bg-black transition-colors disabled:bg-gray-400"
                        >
                            {isSaving ? "ADDING..." : "ADD"}
                        </button>
                    </form>

                    <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                        {players.length === 0 ? (
                            <div className="text-center py-20 bg-gray-50 rounded-2xl border-2 border-dashed">
                                <Users size={32} className="mx-auto text-gray-300 mb-2" />
                                <p className="text-gray-400 text-[10px] font-black uppercase tracking-widest">Your roster is empty</p>
                                <p className="text-gray-300 text-[8px] uppercase mt-2">Add players above to see them here</p>
                            </div>
                        ) : (
                            players.sort((a,b) => b.createdAt - a.createdAt).map(player => (
                                <div key={player.id} className="p-4 bg-gray-50 rounded-2xl border hover:border-navy transition-all group">
                                    <div className="flex justify-between items-start mb-3">
                                        <div>
                                            <div className="font-black text-navy uppercase tracking-tight text-lg">{player.name}</div>
                                            <div className="text-[8px] text-gray-400 font-bold uppercase">Added {new Date(player.createdAt).toLocaleDateString()}</div>
                                        </div>
                                        <button 
                                            onClick={() => deletePlayer(player.id)}
                                            className="p-2 text-gray-200 hover:text-red-500 hover:bg-red-50 transition-all rounded-lg"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                    
                                    <div className="grid grid-cols-4 gap-2">
                                        <div className="bg-white p-2 rounded-xl border border-gray-100 text-center">
                                            <div className="text-xs font-black text-navy">{player.careerRuns || 0}</div>
                                            <div className="text-[7px] text-gray-400 uppercase font-black">Runs</div>
                                        </div>
                                        <div className="bg-white p-2 rounded-xl border border-gray-100 text-center">
                                            <div className="text-xs font-black text-navy">{player.careerWickets || 0}</div>
                                            <div className="text-[7px] text-gray-400 uppercase font-black">Wkts</div>
                                        </div>
                                        <div className="bg-white p-2 rounded-xl border border-gray-100 text-center">
                                            <div className="text-xs font-black text-navy">{player.careerMatches || 0}</div>
                                            <div className="text-[7px] text-gray-400 uppercase font-black">Mtch</div>
                                        </div>
                                        <div className="bg-white p-2 rounded-xl border border-gray-100 text-center">
                                            <div className="text-xs font-black text-navy">{player.careerBalls || 0}</div>
                                            <div className="text-[7px] text-gray-400 uppercase font-black">Balls</div>
                                        </div>
                                    </div>

                                    {(player.orangeCaps || player.purpleCaps) && (
                                        <div className="flex gap-2 mt-2">
                                            {player.orangeCaps && (
                                                <div className="flex items-center gap-1 bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full text-[7px] font-black uppercase">
                                                    <Award size={8} /> Orange Cap x{player.orangeCaps}
                                                </div>
                                            )}
                                            {player.purpleCaps && (
                                                <div className="flex items-center gap-1 bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full text-[7px] font-black uppercase">
                                                    <Award size={8} /> Purple Cap x{player.purpleCaps}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div className="p-6 bg-gray-50 border-t text-center">
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">These players will be available for quick selection in all future tournaments</p>
                </div>
            </motion.div>
        </motion.div>
    );
};
