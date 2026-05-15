import React, { useState, useEffect, useMemo } from 'react';
import { Trophy, Calendar, Search, Users, Award, Play, CheckCircle, Crown, Trash2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import { Match, Team, TournamentState, MatchType } from './types';
import { calculatePointsTable, generateLeagueMatches } from './utils';

const STORAGE_KEY = "cricket_tourney_data_react";

const App: React.FC = () => {
    const [state, setState] = useState<TournamentState>(() => {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) return JSON.parse(saved);
        return {
            active: false,
            name: "",
            teamCount: 0,
            teams: [],
            matches: [],
            playoffs: { champion: null }
        };
    });

    const [activeTab, setActiveTab] = useState<'fixtures' | 'table' | 'playoffs'>('fixtures');
    const [searchTerm, setSearchTerm] = useState("");
    const [editingMatch, setEditingMatch] = useState<Match | null>(null);

    // Persist State
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }, [state]);

    // Derived State
    const pointsTable = useMemo(() => calculatePointsTable(state.teams, state.matches), [state.teams, state.matches]);
    
    const leagueMatches = state.matches.filter(m => m.type === 'league');
    const semiMatches = state.matches.filter(m => m.type === 'semi-final');
    const finalMatch = state.matches.find(m => m.type === 'final');

    const completedLeagueCount = leagueMatches.filter(m => m.status === 'completed').length;
    const isLeagueComplete = leagueMatches.length > 0 && completedLeagueCount === leagueMatches.length;

    // Handlers
    const handleLaunch = (name: string, teamNames: string[]) => {
        const newTeams: Team[] = teamNames.map(n => ({
            name: n, played: 0, won: 0, lost: 0, tied: 0, pts: 0,
            runsScored: 0, oversFaced: 0, runsConceded: 0, oversBowled: 0, nrr: 0
        }));
        const newMatches = generateLeagueMatches(teamNames);
        
        setState({
            active: true,
            name,
            teamCount: teamNames.length,
            teams: newTeams,
            matches: newMatches,
            playoffs: { champion: null }
        });
    };

    const handleUpdateResult = (matchId: number, results: Partial<Match>) => {
        const updatedMatches = state.matches.map(m => {
            if (m.id === matchId) {
                const updated = { ...m, ...results, status: 'completed' as const };
                if (updated.team1Score > updated.team2Score) updated.winner = updated.team1;
                else if (updated.team2Score > updated.team1Score) updated.winner = updated.team2;
                else updated.winner = "Tie";
                return updated;
            }
            return m;
        });

        // Auto-generate semi-finals if league complete
        let finalMatches = updatedMatches;
        const currentMatch = updatedMatches.find(m => m.id === matchId);
        
        if (currentMatch?.type === 'league') {
             const allLeagueDone = updatedMatches.filter(m => m.type === 'league').every(m => m.status === 'completed');
             const hasSemis = updatedMatches.some(m => m.type === 'semi-final');
             if (allLeagueDone && !hasSemis) {
                 const top4 = calculatePointsTable(state.teams, updatedMatches).slice(0, 4);
                 if (top4.length >= 2) {
                     const s1 = { id: updatedMatches.length + 1, team1: top4[0].name, team2: top4[3]?.name || top4[1].name, team1Score: 0, team1Wickets: 0, team2Score: 0, team2Wickets: 0, team1Overs: 0, team2Overs: 0, quota: 20, status: 'upcoming' as const, winner: null, type: 'semi-final' as MatchType };
                     const s2 = { id: updatedMatches.length + 2, team1: top4[1].name, team2: top4[2]?.name || top4[0].name, team1Score: 0, team1Wickets: 0, team2Score: 0, team2Wickets: 0, team1Overs: 0, team2Overs: 0, quota: 20, status: 'upcoming' as const, winner: null, type: 'semi-final' as MatchType };
                     finalMatches = [...updatedMatches, s1, s2];
                 }
             }
        }

        // Auto-generate final if semis complete
        if (currentMatch?.type === 'semi-final') {
            const allSemisDone = finalMatches.filter(m => m.type === 'semi-final').every(m => m.status === 'completed');
            const hasFinal = finalMatches.some(m => m.type === 'final');
            if (allSemisDone && !hasFinal) {
                const winners = finalMatches.filter(m => m.type === 'semi-final').map(m => m.winner);
                if (winners[0] && winners[1] && winners[0] !== 'Tie' && winners[1] !== 'Tie') {
                    const final = { id: finalMatches.length + 1, team1: winners[0], team2: winners[1], team1Score: 0, team1Wickets: 0, team2Score: 0, team2Wickets: 0, team1Overs: 0, team2Overs: 0, quota: 20, status: 'upcoming' as const, winner: null, type: 'final' as MatchType };
                    finalMatches = [...finalMatches, final];
                }
            }
        }

        // Handle Champion
        if (currentMatch?.type === 'final' && currentMatch.winner && currentMatch.winner !== 'Tie') {
            handleChampion(currentMatch.winner);
        }

        setState(prev => ({ ...prev, matches: finalMatches }));
        setEditingMatch(null);
    };

    const handleChampion = (name: string) => {
        setState(prev => ({ ...prev, playoffs: { champion: name } }));
        showConfetti();
    };

    const confirmReset = () => {
        if (window.confirm("🚨 Are you sure you want to reset the tournament? All data will be permanently deleted.")) {
            localStorage.removeItem(STORAGE_KEY);
            window.location.reload();
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

    return (
        <div className="min-h-screen">
            {/* Navbar */}
            <nav className="navbar sticky top-0 z-50 py-3">
                <div className="container mx-auto px-4 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="logo-box p-2">
                            <Trophy size={24} />
                        </div>
                        <span className="brand-text text-uppercase text-2xl font-bold">STUMPS <span style={{ color: 'var(--bcci-gold)' }}>BEYOND</span></span>
                    </div>
                    {state.active && (
                        <button onClick={confirmReset} className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-bold py-1.5 px-4 rounded transition-colors text-xs">
                            <Trash2 size={14} /> DELETE LEAGUE
                        </button>
                    )}
                </div>
            </nav>

            <main className="container mx-auto px-4 py-8">
                {!state.active ? (
                    <SetupForm onLaunch={handleLaunch} />
                ) : (
                    <div className="animate-up">
                        {/* Title Bar */}
                        <div className="mb-10 text-center">
                            <h2 className="text-navy text-4xl font-extrabold uppercase tracking-tight" id="display-tournament-name">{state.name}</h2>
                            <div className="h-1 w-24 bg-bcci-blue mx-auto mt-2 rounded-full"></div>
                        </div>

                        {/* Stats Summary */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                            <StatCard label="Total Fixtures" value={leagueMatches.length} />
                            <StatCard label="Completed" value={completedLeagueCount} color="var(--success-green)" />
                            <StatCard label="Franchises" value={state.teamCount} />
                            <StatCard label="Current Leader" value={pointsTable[0]?.name || "---"} isGold />
                        </div>

                        {/* Tabs */}
                        <div className="flex justify-center mb-8 px-4">
                            <div className="bg-white p-1 rounded border shadow-sm flex gap-1 nav-pills-custom">
                                <TabButton active={activeTab === 'fixtures'} onClick={() => setActiveTab('fixtures')}>Fixtures</TabButton>
                                <TabButton active={activeTab === 'table'} onClick={() => setActiveTab('table')}>Point Standings</TabButton>
                                <TabButton active={activeTab === 'playoffs'} onClick={() => setActiveTab('playoffs')}>Playoffs</TabButton>
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
                                                <h4 className="text-center mb-8 text-gray-500 font-bold uppercase text-xs tracking-[0.2em]">Semi Finals</h4>
                                                <div className="grid md:grid-cols-2 gap-8 justify-items-center">
                                                    {semiMatches.map(m => (
                                                        <div key={m.id} className="w-full max-w-md">
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
                {editingMatch && (
                    <MatchResultModal 
                        match={editingMatch} 
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

// UI Sub-components
const SetupForm: React.FC<{ onLaunch: (name: string, teams: string[]) => void }> = ({ onLaunch }) => {
    const [name, setName] = useState("");
    const [count, setCount] = useState("");
    const [teamNames, setTeamNames] = useState<string[]>([]);

    useEffect(() => {
        const n = parseInt(count);
        if (!isNaN(n)) setTeamNames(Array(n).fill(""));
        else setTeamNames([]);
    }, [count]);

    return (
        <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-xl mx-auto">
            <div className="bg-white rounded-lg p-8 shadow-2xl border border-gray-100">
                <div className="text-center mb-8">
                    <h1 className="text-navy text-4xl font-extrabold mb-2">Create Tournament</h1>
                    <p className="text-gray-500">Experience the game, manage the glory.</p>
                </div>
                <form onSubmit={(e) => { e.preventDefault(); onLaunch(name, teamNames); }} className="space-y-6">
                    <div>
                        <label className="text-navy block text-xs font-bold uppercase tracking-widest mb-2">Tournament Title</label>
                        <input value={name} onChange={(e) => setName(e.target.value)} required type="text" className="w-full px-4 py-3 border-2 rounded focus:border-blue-700 focus:ring-0 transition-all outline-none" placeholder="e.g. IPL 2026" />
                    </div>
                    <div>
                        <label className="text-navy block text-xs font-bold uppercase tracking-widest mb-2">Competitor Slots</label>
                        <select value={count} onChange={(e) => setCount(e.target.value)} required className="w-full px-4 py-3 border-2 rounded focus:border-blue-700 outline-none">
                            <option value="">Select pool size...</option>
                            {[2, 3, 4, 5, 6, 8, 10].map(n => <option key={n} value={n}>{n} Teams</option>)}
                        </select>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {teamNames.map((n, i) => (
                            <div key={i} className="flex">
                                <span className="bg-gray-100 border-2 border-r-0 rounded-l px-3 flex items-center font-bold text-navy">{i + 1}</span>
                                <input 
                                    value={n} 
                                    onChange={(e) => {
                                        const next = [...teamNames];
                                        next[i] = e.target.value;
                                        setTeamNames(next);
                                    }} 
                                    required 
                                    type="text" 
                                    className="w-full px-3 py-2 border-2 rounded-r focus:border-blue-700 outline-none" 
                                    placeholder="Team Name" 
                                />
                            </div>
                        ))}
                    </div>
                    <button type="submit" className="w-full bg-blue-800 hover:bg-blue-900 text-white font-bold py-4 rounded-lg shadow-lg flex items-center justify-center gap-2 transition-all transform hover:scale-[1.02]">
                        <Play size={20} /> LAUNCH TOURNAMENT
                    </button>
                </form>
            </div>
        </motion.section>
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

const MatchResultModal: React.FC<{ match: Match; onClose: () => void; onSave: (id: number, results: Partial<Match>) => void }> = ({ match, onClose, onSave }) => {
    const [data, setData] = useState({
        team1Score: match.team1Score || 0,
        team1Wickets: match.team1Wickets || 0,
        team2Score: match.team2Score || 0,
        team2Wickets: match.team2Wickets || 0,
        team1Overs: match.team1Overs || 0,
        team2Overs: match.team2Overs || 0,
        quota: match.quota || 20
    });

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }} className="bg-white rounded-lg w-full max-w-xl overflow-hidden shadow-2xl">
                <div className="bg-navy p-6 text-white flex justify-between items-center">
                    <h3 className="text-xl font-bold uppercase flex items-center gap-2">Match # {match.id} Result</h3>
                    <button onClick={onClose} className="hover:rotate-90 transition-transform"><X /></button>
                </div>
                <form onSubmit={(e) => { e.preventDefault(); onSave(match.id, data); }} className="p-8 space-y-6">
                    <div className="grid grid-cols-2 gap-8">
                        {/* Team 1 */}
                        <div className="space-y-4">
                            <h4 className="font-bold text-navy uppercase text-sm border-b pb-2">{match.team1}</h4>
                            <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Runs</label>
                                <input type="number" required value={data.team1Score} onChange={e => setData({...data, team1Score: +e.target.value})} className="w-full p-2 border rounded font-bold" />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Wickets</label>
                                <input type="number" required max={10} value={data.team1Wickets} onChange={e => setData({...data, team1Wickets: +e.target.value})} className="w-full p-2 border rounded font-bold" />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Overs Faced</label>
                                <input type="number" step="0.1" required value={data.team1Overs} onChange={e => setData({...data, team1Overs: +e.target.value})} className="w-full p-2 border rounded font-bold" />
                            </div>
                        </div>
                        {/* Team 2 */}
                        <div className="space-y-4">
                            <h4 className="font-bold text-navy uppercase text-sm border-b pb-2">{match.team2}</h4>
                            <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Runs</label>
                                <input type="number" required value={data.team2Score} onChange={e => setData({...data, team2Score: +e.target.value})} className="w-full p-2 border rounded font-bold" />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Wickets</label>
                                <input type="number" required max={10} value={data.team2Wickets} onChange={e => setData({...data, team2Wickets: +e.target.value})} className="w-full p-2 border rounded font-bold" />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Overs Faced</label>
                                <input type="number" step="0.1" required value={data.team2Overs} onChange={e => setData({...data, team2Overs: +e.target.value})} className="w-full p-2 border rounded font-bold" />
                            </div>
                        </div>
                    </div>
                    <div className="pt-6 border-t flex items-center justify-between">
                        <div>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Match Quota (Overs)</label>
                            <input type="number" value={data.quota} onChange={e => setData({...data, quota: +e.target.value})} className="w-20 p-1 border rounded font-bold" />
                        </div>
                        <button type="submit" className="bg-blue-800 text-white font-bold py-3 px-8 rounded shadow-lg hover:bg-blue-900 transition-all">SAVE MATCH DATA</button>
                    </div>
                </form>
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
