import { Match, Team } from './types';

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
