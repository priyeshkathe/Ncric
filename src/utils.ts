import { Match, Team, Player, PlayerPerformance, TournamentState } from './types';

export const calculatePlayerStats = (teams: Team[], matches: Match[]): Player[] => {
    const playerMap: { [key: string]: Player } = {};

    // Initialize players from team lists
    teams.forEach(team => {
        if (team.players) {
            team.players.forEach(playerName => {
                const key = `${playerName.toLowerCase().trim()}-${team.name.toLowerCase().trim()}`;
                playerMap[key] = {
                    name: playerName,
                    team: team.name,
                    runs: 0,
                    wickets: 0,
                    matches: 0
                };
            });
        }
    });

    // Aggregate stats from matches
    matches.filter(m => m.status === 'completed').forEach(m => {
        if (m.playerPerformances) {
            const processPerf = (p: PlayerPerformance, teamName: string) => {
                const key = `${p.playerName.toLowerCase().trim()}-${teamName.toLowerCase().trim()}`;
                if (!playerMap[key]) {
                    playerMap[key] = { name: p.playerName, team: teamName, runs: 0, wickets: 0, matches: 0 };
                }
                playerMap[key].runs += (Number(p.runs) || 0);
                playerMap[key].wickets += (Number(p.wickets) || 0);
                playerMap[key].matches += 1;
            };

            m.playerPerformances.team1Players.forEach(p => processPerf(p, m.team1));
            m.playerPerformances.team2Players.forEach(p => processPerf(p, m.team2));
        }
    });

    return Object.values(playerMap)
        .filter(p => p.runs > 0 || p.wickets > 0)
        .sort((a, b) => b.runs - a.runs || b.wickets - a.wickets);
};

export const calculateCareerStats = (tournaments: TournamentState[]): Player[] => {
    const careerMap: { [key: string]: Player } = {};

    tournaments.forEach(t => {
        t.matches.filter(m => m.status === 'completed').forEach(m => {
            if (m.playerPerformances) {
                const processPerf = (p: PlayerPerformance) => {
                    const nameKey = p.playerName.trim().toLowerCase();
                    if (!careerMap[nameKey]) {
                        careerMap[nameKey] = {
                            name: p.playerName.trim(),
                            team: "VARIOUS",
                            runs: 0,
                            wickets: 0,
                            matches: 0
                        };
                    }
                    careerMap[nameKey].runs += (Number(p.runs) || 0);
                    careerMap[nameKey].wickets += (Number(p.wickets) || 0);
                    careerMap[nameKey].matches += 1;
                };

                m.playerPerformances.team1Players.forEach(p => processPerf(p));
                m.playerPerformances.team2Players.forEach(p => processPerf(p));
            }
        });
    });

    return Object.values(careerMap)
        .filter(p => p.matches > 0)
        .sort((a, b) => b.runs - a.runs || b.wickets - a.wickets);
};

export const calculatePointsTable = (teams: Team[], matches: Match[]): Team[] => {
    // Reset stats
    const table: Team[] = teams.map(t => ({
        ...t,
        played: 0, won: 0, lost: 0, tied: 0, pts: 0,
        runsScored: 0, oversFaced: 0, runsConceded: 0, oversBowled: 0, nrr: 0
    }));

    matches.filter(m => m.status === 'completed' && m.type === 'league').forEach(m => {
        const t1 = table.find(t => t.name === m.team1);
        const t2 = table.find(t => t.name === m.team2);

        if (!t1 || !t2) return;

        t1.played++; t2.played++;
        t1.runsScored += m.team1Score; t1.runsConceded += m.team2Score;
        t2.runsScored += m.team2Score; t2.runsConceded += m.team1Score;

        t1.oversFaced += m.team1Overs; t1.oversBowled += m.team2Overs;
        t2.oversFaced += m.team2Overs; t2.oversBowled += m.team1Overs;

        if (m.winner === m.team1) { t1.won++; t1.pts += 2; t2.lost++; }
        else if (m.winner === m.team2) { t2.won++; t2.pts += 2; t1.lost++; }
        else { t1.tied++; t1.pts += 1; t2.tied++; t2.pts += 1; }
    });

    // Calculate NRR
    table.forEach(t => {
        if (t.oversFaced > 0) {
            const convertToDecimal = (overs: number) => {
                const fullOvers = Math.floor(overs);
                const balls = Math.round((overs - fullOvers) * 10);
                return fullOvers + (balls / 6);
            };

            const decimalFaced = convertToDecimal(t.oversFaced);
            const decimalBowled = convertToDecimal(t.oversBowled);

            const runRateFaced = t.runsScored / (decimalFaced || 0.1);
            const runRateAgainst = t.runsConceded / (decimalBowled || 0.1);
            t.nrr = (runRateFaced - runRateAgainst).toFixed(3);
        } else {
            t.nrr = "0.000";
        }
    });

    return table.sort((a, b) => (b.pts as number) - (a.pts as number) || parseFloat(b.nrr as string) - parseFloat(a.nrr as string));
};

export const generateLeagueMatches = (teams: string[]): Match[] => {
    let leagueTeams = [...teams];
    if (leagueTeams.length % 2 !== 0) {
        leagueTeams.push("BYE");
    }

    const n = leagueTeams.length;
    const rounds = n - 1;
    const matchesPerRound = n / 2;
    const matches: Match[] = [];

    for (let i = 0; i < rounds; i++) {
        for (let j = 0; j < matchesPerRound; j++) {
            const team1 = leagueTeams[j];
            const team2 = leagueTeams[n - 1 - j];

            if (team1 !== "BYE" && team2 !== "BYE") {
                matches.push({
                    id: matches.length + 1,
                    team1,
                    team2,
                    team1Score: 0,
                    team1Wickets: 0,
                    team2Score: 0,
                    team2Wickets: 0,
                    team1Overs: 0,
                    team2Overs: 0,
                    quota: 20,
                    status: 'upcoming',
                    winner: null,
                    type: 'league'
                });
            }
        }
        leagueTeams.splice(1, 0, leagueTeams.pop()!);
    }
    return matches;
};
